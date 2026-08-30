package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"gpt-image-backend/internal/middleware"
	"gpt-image-backend/internal/models"
)

type adminUserStoreStub struct {
	users []models.User
}

func (s *adminUserStoreStub) List(context.Context) ([]models.User, error) {
	return s.users, nil
}

type adminProjectStoreStub struct {
	projects []models.OnlineProject
	archive  []byte
	images   []models.ProjectImage
}

func (s *adminProjectStoreStub) List(context.Context, string) ([]models.OnlineProject, error) {
	return s.projects, nil
}

func (s *adminProjectStoreStub) Get(_ context.Context, _, _ string) (*models.OnlineProject, []byte, error) {
	return &s.projects[0], s.archive, nil
}

func (s *adminProjectStoreStub) ListImages(context.Context, string, string) ([]models.ProjectImage, error) {
	return s.images, nil
}

func (s *adminProjectStoreStub) GetImage(context.Context, string, string, string) (*models.ProjectImage, []byte, error) {
	return &s.images[0], []byte("image-data"), nil
}

func newAdminRouter(isAdmin bool) *gin.Engine {
	gin.SetMode(gin.TestMode)
	userStore := &adminUserStoreStub{users: []models.User{{ID: "a6d80cf2-976f-4b2c-8b2e-64fc0d4e77e8", OIDCProvider: "oidc", OIDCSub: "private-sub", Email: "user@example.com", CreatedAt: time.Unix(1, 0)}}}
	projectStore := &adminProjectStoreStub{
		projects: []models.OnlineProject{{ID: "86d80cf2-976f-4b2c-8b2e-64fc0d4e77e8", Title: "画布 A", ArchiveSHA256: "sha"}},
		archive:  []byte("PK archive"),
		images:   []models.ProjectImage{{ProjectID: "86d80cf2-976f-4b2c-8b2e-64fc0d4e77e8", ImageID: "image-a", MIMEType: "image/png"}},
	}
	r := gin.New()
	api := r.Group("/api/v1", func(c *gin.Context) {
		c.Set(middleware.ContextKeyUserID, "admin-1")
		c.Next()
	})
	NewAdminHandler(userStore, projectStore, func(context.Context, string) (bool, error) { return isAdmin, nil }).Register(api)
	return r
}

func TestAdminHandlerListUsersDoesNotExposeOIDCSub(t *testing.T) {
	r := newAdminRouter(true)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/admin/users", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", w.Code, w.Body.String())
	}
	if got := w.Body.String(); got == "" || containsString(got, "private-sub") {
		t.Fatalf("response unexpectedly exposes private user data: %s", got)
	}
}

func TestAdminHandlerRequiresAdmin(t *testing.T) {
	r := newAdminRouter(false)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/admin/users", nil))
	if w.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d body=%s", w.Code, w.Body.String())
	}
}

func TestAdminHandlerServesProjectArchiveAndImages(t *testing.T) {
	r := newAdminRouter(true)
	for _, path := range []string{
		"/api/v1/admin/users/a6d80cf2-976f-4b2c-8b2e-64fc0d4e77e8/projects/86d80cf2-976f-4b2c-8b2e-64fc0d4e77e8",
		"/api/v1/admin/users/a6d80cf2-976f-4b2c-8b2e-64fc0d4e77e8/projects/86d80cf2-976f-4b2c-8b2e-64fc0d4e77e8/images",
		"/api/v1/admin/users/a6d80cf2-976f-4b2c-8b2e-64fc0d4e77e8/projects/86d80cf2-976f-4b2c-8b2e-64fc0d4e77e8/images/image-a",
	} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusOK {
			t.Fatalf("%s: want 200, got %d body=%s", path, w.Code, w.Body.String())
		}
	}
}

func containsString(value, needle string) bool {
	for index := 0; index+len(needle) <= len(value); index++ {
		if value[index:index+len(needle)] == needle {
			return true
		}
	}
	return false
}
