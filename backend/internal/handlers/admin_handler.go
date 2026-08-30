package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"gpt-image-backend/internal/database"
	"gpt-image-backend/internal/middleware"
	"gpt-image-backend/internal/models"
)

type adminUserStore interface {
	List(context.Context) ([]models.User, error)
}

type adminProjectStore interface {
	List(context.Context, string) ([]models.OnlineProject, error)
	Get(context.Context, string, string) (*models.OnlineProject, []byte, error)
	ListImages(context.Context, string, string) ([]models.ProjectImage, error)
	GetImage(context.Context, string, string, string) (*models.ProjectImage, []byte, error)
}

type AdminHandler struct {
	users    adminUserStore
	projects adminProjectStore
	isAdmin  func(context.Context, string) (bool, error)
}

func NewAdminHandler(users adminUserStore, projects adminProjectStore, isAdmin func(context.Context, string) (bool, error)) *AdminHandler {
	return &AdminHandler{users: users, projects: projects, isAdmin: isAdmin}
}

func (h *AdminHandler) Register(api *gin.RouterGroup) {
	api.GET("/admin/users", h.ListUsers)
	api.GET("/admin/users/:userId/projects", h.ListUserProjects)
	api.GET("/admin/users/:userId/projects/:projectId", h.GetUserProject)
	api.GET("/admin/users/:userId/projects/:projectId/images", h.ListUserProjectImages)
	api.GET("/admin/users/:userId/projects/:projectId/images/:imageId", h.GetUserProjectImage)
}

func (h *AdminHandler) ListUsers(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	users, err := h.users.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}
	profiles := make([]models.AdminProfile, 0, len(users))
	for index := range users {
		profiles = append(profiles, users[index].ToAdminProfile())
	}
	c.JSON(http.StatusOK, gin.H{"users": profiles})
}

func (h *AdminHandler) ListUserProjects(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	userID := strings.TrimSpace(c.Param("userId"))
	if !projectUUIDPattern.MatchString(userID) {
		c.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "valid user id required"})
		return
	}
	projects, err := h.projects.List(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"projects": projects})
}

func (h *AdminHandler) GetUserProject(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	userID := strings.TrimSpace(c.Param("userId"))
	projectID := strings.TrimSpace(c.Param("projectId"))
	if !projectUUIDPattern.MatchString(userID) || !projectUUIDPattern.MatchString(projectID) {
		c.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "valid user and project ids required"})
		return
	}
	project, archive, err := h.projects.Get(c.Request.Context(), userID, projectID)
	if errors.Is(err, database.ErrProjectNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"code": http.StatusNotFound, "message": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}
	c.Header("ETag", `"`+project.ArchiveSHA256+`"`)
	c.Header("Content-Disposition", `attachment; filename="`+project.ID+`.zip"`)
	c.Data(http.StatusOK, "application/zip", archive)
}

func (h *AdminHandler) ListUserProjectImages(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	userID := strings.TrimSpace(c.Param("userId"))
	projectID := strings.TrimSpace(c.Param("projectId"))
	if !projectUUIDPattern.MatchString(userID) || !projectUUIDPattern.MatchString(projectID) {
		c.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "valid user and project ids required"})
		return
	}
	images, err := h.projects.ListImages(c.Request.Context(), userID, projectID)
	if errors.Is(err, database.ErrProjectNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"code": http.StatusNotFound, "message": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, images)
}

func (h *AdminHandler) GetUserProjectImage(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	userID := strings.TrimSpace(c.Param("userId"))
	projectID := strings.TrimSpace(c.Param("projectId"))
	imageID := strings.TrimSpace(c.Param("imageId"))
	if !projectUUIDPattern.MatchString(userID) || !projectUUIDPattern.MatchString(projectID) || !projectImageIDPattern.MatchString(imageID) {
		c.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "valid user, project and image ids required"})
		return
	}
	image, data, err := h.projects.GetImage(c.Request.Context(), userID, projectID, imageID)
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

func (h *AdminHandler) requireAdmin(c *gin.Context) bool {
	userID := c.GetString(middleware.ContextKeyUserID)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": "unauthenticated"})
		return false
	}
	ok, err := h.isAdmin(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return false
	}
	if !ok {
		c.JSON(http.StatusForbidden, gin.H{"code": http.StatusForbidden, "message": "admin access required"})
		return false
	}
	return true
}
