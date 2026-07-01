package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"gpt-image-backend/internal/database"
)

// HealthHandler 提供 /health 与 /health/ready 端点
type HealthHandler struct {
	db *database.DB
}

// NewHealthHandler 构造 HealthHandler
func NewHealthHandler(db *database.DB) *HealthHandler {
	return &HealthHandler{db: db}
}

// Register 挂载路由
func (h *HealthHandler) Register(r *gin.Engine) {
	r.GET("/health", h.Live)
	r.GET("/health/ready", h.Ready)
}

// Live 进程级健康检查（永远 200）
func (h *HealthHandler) Live(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "ok",
		"timestamp": time.Now().Unix(),
	})
}

// Ready 包含数据库 ping 的就绪检查
func (h *HealthHandler) Ready(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()

	checks := gin.H{}
	status := http.StatusOK

	if h.db != nil {
		if err := h.db.Ping(ctx); err != nil {
			checks["database"] = gin.H{"ok": false, "error": err.Error()}
			status = http.StatusServiceUnavailable
		} else {
			checks["database"] = gin.H{"ok": true}
		}
	}

	c.JSON(status, gin.H{
		"status":    statusText(status),
		"timestamp": time.Now().Unix(),
		"checks":    checks,
	})
}

func statusText(status int) string {
	if status == http.StatusOK {
		return "ok"
	}
	return "degraded"
}
