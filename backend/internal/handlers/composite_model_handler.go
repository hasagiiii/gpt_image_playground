package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"gpt-image-backend/internal/middleware"
	"gpt-image-backend/pkg/config"
)

const compositeAPIKeyHeader = "X-Upstream-API-Key"
const maxCompositeResponseBytes = 64 << 20
const compositeIdempotencyTTL = 10 * time.Minute

type CompositeModelHandler struct {
	providers            imageProviderRegistry
	upstream             config.CompositeAPIUpstreamConfig
	client               *http.Client
	idempotencyMu        sync.Mutex
	idempotencyResponses map[string]*compositeIdempotencyEntry
}

type compositeIdempotencyEntry struct {
	done        chan struct{}
	status      int
	contentType string
	body        []byte
}

func NewCompositeModelHandler(providers imageProviderRegistry, upstreams ...config.CompositeAPIUpstreamConfig) *CompositeModelHandler {
	upstream := config.DefaultUpstreamConfig().CompositeAPI
	if len(upstreams) > 0 {
		upstream = config.NormalizeUpstreamConfig(config.UpstreamConfig{CompositeAPI: upstreams[0]}).CompositeAPI
	}
	return &CompositeModelHandler{
		providers:            providers,
		upstream:             upstream,
		client:               &http.Client{Timeout: 2 * time.Minute},
		idempotencyResponses: make(map[string]*compositeIdempotencyEntry),
	}
}

func (h *CompositeModelHandler) beginCompositeIdempotency(key string) (*compositeIdempotencyEntry, bool) {
	h.idempotencyMu.Lock()
	defer h.idempotencyMu.Unlock()
	if entry, ok := h.idempotencyResponses[key]; ok {
		return entry, false
	}
	entry := &compositeIdempotencyEntry{done: make(chan struct{})}
	h.idempotencyResponses[key] = entry
	return entry, true
}

func (h *CompositeModelHandler) completeCompositeIdempotency(key string, entry *compositeIdempotencyEntry, status int, contentType string, body []byte) {
	h.idempotencyMu.Lock()
	entry.status = status
	entry.contentType = contentType
	entry.body = append([]byte(nil), body...)
	close(entry.done)
	if status < http.StatusOK || status >= http.StatusMultipleChoices {
		delete(h.idempotencyResponses, key)
	}
	h.idempotencyMu.Unlock()
	if status >= http.StatusOK && status < http.StatusMultipleChoices {
		time.AfterFunc(compositeIdempotencyTTL, func() {
			h.idempotencyMu.Lock()
			if h.idempotencyResponses[key] == entry {
				delete(h.idempotencyResponses, key)
			}
			h.idempotencyMu.Unlock()
		})
	}
}

func replayCompositeIdempotency(c *gin.Context, entry *compositeIdempotencyEntry) {
	select {
	case <-entry.done:
	case <-c.Request.Context().Done():
		return
	}
	contentType := entry.contentType
	if contentType == "" {
		contentType = "application/json"
	}
	c.Data(entry.status, contentType, entry.body)
}

func (h *CompositeModelHandler) Register(api *gin.RouterGroup) {
	api.GET("/model/*path", h.Proxy)
	api.POST("/model/*path", h.Proxy)
}

func escapedCompositePath(value string) (string, bool) {
	parts := strings.Split(strings.Trim(value, "/"), "/")
	if len(parts) == 0 {
		return "", false
	}
	for index, part := range parts {
		if part == "" || part == "." || part == ".." {
			return "", false
		}
		parts[index] = url.PathEscape(part)
	}
	return strings.Join(parts, "/"), true
}

// Proxy 只代理单次异步 API 请求，提交、轮询和取结果由前端分别调用。
func (h *CompositeModelHandler) Proxy(c *gin.Context) {
	userID := c.GetString(middleware.ContextKeyUserID)
	providerName := c.GetString(middleware.ContextKeyProvider)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": "unauthenticated"})
		return
	}
	apiKey := strings.TrimSpace(c.GetHeader(compositeAPIKeyHeader))
	if apiKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": compositeAPIKeyHeader + " is required"})
		return
	}
	path, ok := escapedCompositePath(c.Param("path"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "valid model path required"})
		return
	}
	baseURL, ok := h.providers.ResourceBaseURL(providerName)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "image provider unavailable"})
		return
	}

	var body []byte
	if c.Request.Body != nil {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxGenerationRequestBytes)
		var err error
		body, err = io.ReadAll(c.Request.Body)
		if err != nil {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"code": http.StatusRequestEntityTooLarge, "message": "request body is too large"})
			return
		}
	}
	endpoint := config.JoinUpstreamURL(config.ResolveUpstreamBaseURL(h.upstream.BaseURL, baseURL), config.CompositeModelPath) + "/" + path
	if c.Request.URL.RawQuery != "" {
		endpoint += "?" + c.Request.URL.RawQuery
	}
	log.Ctx(c.Request.Context()).Info().
		Str("method", c.Request.Method).
		Str("path", c.Request.URL.Path).
		Str("upstream_url", endpoint).
		Str("user_id", userID).
		Interface("body", generationLogPayload(body, len(body) > maxGenerationLogResponseBytes)).
		Msg("composite model proxy request")

	request, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, endpoint, bytes.NewReader(body))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"code": http.StatusBadGateway, "message": err.Error()})
		return
	}
	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", c.Request.UserAgent())
	middleware.SetRequestIDHeader(request)
	if contentType := c.GetHeader("Content-Type"); contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}

	var idempotencyKey string
	var idempotencyEntry *compositeIdempotencyEntry
	if c.Request.Method == http.MethodPost {
		idempotencyValue := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
		if idempotencyValue == "" {
			idempotencyValue = middleware.RequestIDFromContext(c.Request.Context())
		}
		idempotencyKey = userID + "\x00" + providerName + "\x00" + path + "\x00" + idempotencyValue
		var idempotencyOwner bool
		idempotencyEntry, idempotencyOwner = h.beginCompositeIdempotency(idempotencyKey)
		if !idempotencyOwner {
			replayCompositeIdempotency(c, idempotencyEntry)
			return
		}
		request.Header.Set("Idempotency-Key", idempotencyValue)
		requestCtx, cancel := context.WithTimeout(context.WithoutCancel(c.Request.Context()), 2*time.Minute)
		defer cancel()
		request = request.WithContext(requestCtx)
	}
	completeIdempotency := func(status int, contentType string, responseBody []byte) {
		if idempotencyEntry != nil {
			h.completeCompositeIdempotency(idempotencyKey, idempotencyEntry, status, contentType, responseBody)
			idempotencyEntry = nil
		}
	}
	defer func() {
		if idempotencyEntry == nil {
			return
		}
		body, _ := json.Marshal(gin.H{"code": http.StatusInternalServerError, "message": "Composite 代理请求未完成"})
		completeIdempotency(http.StatusInternalServerError, "application/json", body)
	}()

	response, err := h.client.Do(request)
	if err != nil {
		log.Ctx(c.Request.Context()).Error().Err(err).Str("method", c.Request.Method).Str("upstream_url", endpoint).Msg("composite model proxy response")
		responseData, _ := json.Marshal(gin.H{"code": http.StatusBadGateway, "message": "Composite 上游连接失败: " + err.Error()})
		completeIdempotency(http.StatusBadGateway, "application/json", responseData)
		c.Data(http.StatusBadGateway, "application/json", responseData)
		return
	}
	defer response.Body.Close()
	responseData, err := io.ReadAll(io.LimitReader(response.Body, maxCompositeResponseBytes+1))
	if err != nil {
		responseData, _ := json.Marshal(gin.H{"code": http.StatusBadGateway, "message": "读取 Composite 上游回包失败"})
		completeIdempotency(http.StatusBadGateway, "application/json", responseData)
		c.Data(http.StatusBadGateway, "application/json", responseData)
		return
	}
	if len(responseData) > maxCompositeResponseBytes {
		responseData, _ := json.Marshal(gin.H{"code": http.StatusBadGateway, "message": "Composite 上游回包过大"})
		completeIdempotency(http.StatusBadGateway, "application/json", responseData)
		c.Data(http.StatusBadGateway, "application/json", responseData)
		return
	}
	log.Ctx(c.Request.Context()).Info().
		Str("method", c.Request.Method).
		Str("upstream_url", endpoint).
		Str("upstream_request_id", response.Header.Get("X-Request-ID")).
		Int("status", response.StatusCode).
		Interface("body", generationLogPayload(responseData, len(responseData) > maxGenerationLogResponseBytes)).
		Msg("composite model proxy response")

	for _, name := range []string{"Content-Type", "Cache-Control", "Retry-After"} {
		if value := response.Header.Get(name); value != "" {
			c.Header(name, value)
		}
	}
	completeIdempotency(response.StatusCode, response.Header.Get("Content-Type"), responseData)
	c.Data(response.StatusCode, response.Header.Get("Content-Type"), responseData)
}
