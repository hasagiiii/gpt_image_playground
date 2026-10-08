package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gpt-image-backend/internal/database"
	"gpt-image-backend/internal/middleware"
	"gpt-image-backend/internal/models"
)

const maxProjectImageBytes = 64 << 20

var projectImageIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,200}$`)

func generatedProjectImageID(imageURL string) string {
	digest := sha256.Sum256([]byte(imageURL))
	return hex.EncodeToString(digest[:])
}

type projectImageStore interface {
	SaveImage(ctx context.Context, userID string, image models.ProjectImage, data []byte) (*models.ProjectImage, error)
	ListImages(ctx context.Context, userID, projectID string) ([]models.ProjectImage, error)
	DeleteImage(ctx context.Context, userID, projectID, imageID string) error
}

type projectImageLegacyStore interface {
	GetImage(ctx context.Context, userID, projectID, imageID string) (*models.ProjectImage, []byte, error)
}

type projectImageUploader interface {
	Upload(ctx context.Context, provider, fileName, contentType string, data []byte) (*fileUploadResult, error)
}

// ProjectImageHandler 处理在线项目图片接口。
type ProjectImageHandler struct {
	images   projectImageStore
	uploader projectImageUploader
}

func NewProjectImageHandler(images projectImageStore, uploader ...projectImageUploader) *ProjectImageHandler {
	h := &ProjectImageHandler{images: images}
	if len(uploader) > 0 {
		h.uploader = uploader[0]
	}
	return h
}

func (h *ProjectImageHandler) Register(api *gin.RouterGroup) {
	api.GET("/projects/:id/images", h.List)
	api.GET("/projects/:id/images/:imageId", h.Get)
	api.POST("/projects/:id/images", h.Save)
	api.DELETE("/projects/:id/images/:imageId", h.Delete)
}

// Get GET /api/v1/projects/:id/images/:imageId，兼容旧版图片二进制读取。
func (h *ProjectImageHandler) Get(c *gin.Context) {
	userID := c.GetString(middleware.ContextKeyUserID)
	projectID, imageID, ok := projectImageRequestIDs(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": "unauthenticated"})
		return
	}
	if !ok {
		return
	}
	legacyStore, ok := h.images.(projectImageLegacyStore)
	if !ok {
		c.JSON(http.StatusNotImplemented, gin.H{"code": http.StatusNotImplemented, "message": "legacy project image storage unavailable"})
		return
	}
	image, data, err := legacyStore.GetImage(c.Request.Context(), userID, projectID, imageID)
	if errors.Is(err, database.ErrProjectNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"code": http.StatusNotFound, "message": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}
	if image.ImageURL != "" && len(data) == 0 {
		c.Redirect(http.StatusFound, image.ImageURL)
		return
	}
	c.Header("ETag", `"`+image.SHA256+`"`)
	c.Data(http.StatusOK, image.MIMEType, data)
}

func mimeExtension(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	default:
		return ".png"
	}
}

func projectImageRequestIDs(c *gin.Context) (string, string, bool) {
	projectID := strings.TrimSpace(c.Param("id"))
	imageID := strings.TrimSpace(c.Param("imageId"))
	if !projectUUIDPattern.MatchString(projectID) || (imageID != "" && !projectImageIDPattern.MatchString(imageID)) {
		c.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "valid project and image ids required"})
		return "", "", false
	}
	return projectID, imageID, true
}

// List GET /api/v1/projects/:id/images，返回图片元数据列表。
func (h *ProjectImageHandler) List(c *gin.Context) {
	userID := c.GetString(middleware.ContextKeyUserID)
	projectID, _, ok := projectImageRequestIDs(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": "unauthenticated"})
		return
	}
	if !ok {
		return
	}
	images, err := h.images.ListImages(c.Request.Context(), userID, projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, images)
}

func parseImageDimension(value string) (*int, error) {
	if value == "" {
		return nil, nil
	}
	dimension, err := strconv.Atoi(value)
	if err != nil || dimension <= 0 || dimension > 100000 {
		return nil, errors.New("invalid image dimension")
	}
	return &dimension, nil
}

// Save POST /api/v1/projects/:id/images，生成完成时立即保存单张图片。
func (h *ProjectImageHandler) Save(c *gin.Context) {
	userID := c.GetString(middleware.ContextKeyUserID)
	projectID, _, ok := projectImageRequestIDs(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": "unauthenticated"})
		return
	}
	if !ok {
		return
	}
	imageID := strings.TrimSpace(c.PostForm("image_id"))
	taskID := strings.TrimSpace(c.PostForm("task_id"))
	source := strings.TrimSpace(c.PostForm("source"))
	if (imageID != "" && !projectImageIDPattern.MatchString(imageID)) || (taskID != "" && !projectImageIDPattern.MatchString(taskID)) {
		c.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "valid image and task ids required"})
		return
	}
	if source != "" && source != "upload" && source != "generated" && source != "mask" {
		c.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "valid image source required"})
		return
	}
	width, err := parseImageDimension(strings.TrimSpace(c.PostForm("width")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": err.Error()})
		return
	}
	height, err := parseImageDimension(strings.TrimSpace(c.PostForm("height")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": err.Error()})
		return
	}
	imageURL := strings.TrimSpace(c.PostForm("image_url"))
	var data []byte
	mimeType := strings.TrimSpace(c.PostForm("mime_type"))
	imageSize := int64(0)
	imageSHA256 := strings.TrimSpace(c.PostForm("image_sha256"))
	if imageURL != "" {
		parsedURL, parseErr := url.ParseRequestURI(imageURL)
		if parseErr != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") || parsedURL.Host == "" {
			c.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "valid image URL required"})
			return
		}
		if !strings.HasPrefix(mimeType, "image/") {
			mimeType = "image/png"
		}
		if imageSHA256 == "" {
			digest := sha256.Sum256([]byte(imageURL))
			imageSHA256 = hex.EncodeToString(digest[:])
		}
	} else {
		header, formErr := c.FormFile("image")
		if formErr != nil || header.Size <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "project image or image URL required"})
			return
		}
		if header.Size > maxProjectImageBytes {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"code": http.StatusRequestEntityTooLarge, "message": "project image exceeds 64 MiB"})
			return
		}
		file, openErr := header.Open()
		if openErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "open project image failed"})
			return
		}
		data, err = io.ReadAll(io.LimitReader(file, maxProjectImageBytes+1))
		file.Close()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "read project image failed"})
			return
		}
		if len(data) > maxProjectImageBytes {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"code": http.StatusRequestEntityTooLarge, "message": "project image exceeds 64 MiB"})
			return
		}
		if mimeType == "" {
			mimeType = strings.TrimSpace(header.Header.Get("Content-Type"))
		}
		detectedMimeType := http.DetectContentType(data)
		if !strings.HasPrefix(mimeType, "image/") {
			mimeType = detectedMimeType
		}
		if !strings.HasPrefix(mimeType, "image/") {
			c.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "uploaded file must be an image"})
			return
		}
		if h.uploader == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"code": http.StatusServiceUnavailable, "message": "project image URL upload unavailable"})
			return
		}
		result, uploadErr := h.uploader.Upload(c.Request.Context(), c.GetString(middleware.ContextKeyProvider), filepath.Base(header.Filename), mimeType, data)
		if uploadErr != nil || result == nil || strings.TrimSpace(result.URL) == "" {
			c.JSON(http.StatusBadGateway, gin.H{"code": http.StatusBadGateway, "message": "project image URL upload failed"})
			return
		}
		imageURL = strings.TrimSpace(result.URL)
		imageSize = int64(len(data))
		digest := sha256.Sum256(data)
		imageSHA256 = hex.EncodeToString(digest[:])
	}
	if imageSizeValue := strings.TrimSpace(c.PostForm("image_size")); imageSizeValue != "" {
		if parsedSize, parseErr := strconv.ParseInt(imageSizeValue, 10, 64); parseErr == nil && parsedSize >= 0 {
			imageSize = parsedSize
		}
	}
	// 新图片与生图接口共用后端 ID，旧记录同步时保留已有引用。
	if imageID == "" {
		imageID = generatedProjectImageID(imageURL)
	}
	image, err := h.images.SaveImage(c.Request.Context(), userID, models.ProjectImage{
		ProjectID: projectID,
		ImageID:   imageID,
		TaskID:    taskID,
		Source:    source,
		MIMEType:  mimeType,
		Width:     width,
		Height:    height,
		ImageURL:  imageURL,
		ImageSize: imageSize,
		SHA256:    imageSHA256,
	}, nil)
	if errors.Is(err, database.ErrProjectNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"code": http.StatusNotFound, "message": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, image)
}

// Delete DELETE /api/v1/projects/:id/images/:imageId，删除不再被项目引用的图片。
func (h *ProjectImageHandler) Delete(c *gin.Context) {
	userID := c.GetString(middleware.ContextKeyUserID)
	projectID, imageID, ok := projectImageRequestIDs(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": "unauthenticated"})
		return
	}
	if !ok {
		return
	}
	err := h.images.DeleteImage(c.Request.Context(), userID, projectID, imageID)
	if errors.Is(err, database.ErrProjectNotFound) {
		c.Status(http.StatusNoContent)
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}
