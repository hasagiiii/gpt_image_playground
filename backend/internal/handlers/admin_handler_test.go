package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"gpt-image-backend/internal/database"
	"gpt-image-backend/internal/middleware"
	"gpt-image-backend/internal/models"
	"gpt-image-backend/internal/services"
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

type adminMaterialStoreStub struct {
	userID   string
	kind     string
	keyword  string
	page     int32
	pageSize int32
}

func (s *adminMaterialStoreStub) List(_ context.Context, userID, kind, keyword string, page, pageSize int32) (*services.MaterialList, error) {
	s.userID = userID
	s.kind = kind
	s.keyword = keyword
	s.page = page
	s.pageSize = pageSize
	return &services.MaterialList{
		Items: []*services.MaterialItem{{ID: "material-a", FileName: "参考图.png", Kind: "image"}},
		Total: 1, Page: page, PageSize: pageSize,
	}, nil
}

func (s *adminProjectStoreStub) List(_ context.Context, userID string) ([]models.OnlineProject, error) {
	if len(s.projects) == 0 || s.projects[0].UserID != userID {
		return []models.OnlineProject{}, nil
	}
	return s.projects, nil
}

func (s *adminProjectStoreStub) Get(_ context.Context, userID, projectID string) (*models.OnlineProject, []byte, error) {
	if len(s.projects) == 0 || s.projects[0].UserID != userID || s.projects[0].ID != projectID {
		return nil, nil, database.ErrProjectNotFound
	}
	return &s.projects[0], s.archive, nil
}

func (s *adminProjectStoreStub) ListImages(_ context.Context, userID, projectID string) ([]models.ProjectImage, error) {
	if len(s.projects) == 0 || s.projects[0].UserID != userID || s.projects[0].ID != projectID {
		return nil, database.ErrProjectNotFound
	}
	return s.images, nil
}

func (s *adminProjectStoreStub) GetImage(_ context.Context, userID, projectID, imageID string) (*models.ProjectImage, []byte, error) {
	if len(s.projects) == 0 || s.projects[0].UserID != userID || s.projects[0].ID != projectID || len(s.images) == 0 || s.images[0].ImageID != imageID {
		return nil, nil, database.ErrProjectNotFound
	}
	return &s.images[0], []byte("image-data"), nil
}

func newAdminRouterWithMaterials(isAdmin bool) (*gin.Engine, *adminMaterialStoreStub) {
	gin.SetMode(gin.TestMode)
	lastProjectUpdatedAt := time.Unix(2, 0)
	userStore := &adminUserStoreStub{users: []models.User{{ID: "a6d80cf2-976f-4b2c-8b2e-64fc0d4e77e8", OIDCProvider: "oidc", OIDCSub: "private-sub", Email: "user@example.com", CreatedAt: time.Unix(1, 0), LastProjectUpdatedAt: &lastProjectUpdatedAt}}}
	projectStore := &adminProjectStoreStub{
		projects: []models.OnlineProject{{ID: "86d80cf2-976f-4b2c-8b2e-64fc0d4e77e8", UserID: "a6d80cf2-976f-4b2c-8b2e-64fc0d4e77e8", Title: "画布 A", ArchiveSHA256: "sha", ImageCount: 3}},
		archive:  []byte("PK archive"),
		images:   []models.ProjectImage{{ProjectID: "86d80cf2-976f-4b2c-8b2e-64fc0d4e77e8", ImageID: "image-a", MIMEType: "image/png"}},
	}
	materialStore := &adminMaterialStoreStub{}
	r := gin.New()
	api := r.Group("/api/v1", func(c *gin.Context) {
		c.Set(middleware.ContextKeyUserID, "admin-1")
		c.Next()
	})
	NewAdminHandler(userStore, projectStore, materialStore, func(context.Context, string) (bool, error) { return isAdmin, nil }).Register(api)
	return r, materialStore
}

func newAdminRouter(isAdmin bool) *gin.Engine {
	r, _ := newAdminRouterWithMaterials(isAdmin)
	return r
}

func TestAdminHandlerListUsersDoesNotExposeOIDCSub(t *testing.T) {
	r := newAdminRouter(true)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/admin/users", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", w.Code, w.Body.String())
	}
	if got := w.Body.String(); got == "" || containsString(got, "private-sub") || !containsString(got, "last_project_updated_at") {
		t.Fatalf("response unexpectedly exposes private user data: %s", got)
	}
}

func TestAdminHandlerListsProjectImageCount(t *testing.T) {
	r := newAdminRouter(true)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/admin/users/a6d80cf2-976f-4b2c-8b2e-64fc0d4e77e8/projects", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", w.Code, w.Body.String())
	}
	if !containsString(w.Body.String(), `"image_count":3`) {
		t.Fatalf("response should include project image count: %s", w.Body.String())
	}
}

func TestAdminHandlerListsUserMaterialsReadOnly(t *testing.T) {
	r, materials := newAdminRouterWithMaterials(true)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/admin/users/a6d80cf2-976f-4b2c-8b2e-64fc0d4e77e8/materials?kind=image&keyword=%E5%8F%82%E8%80%83&page=2&page_size=12", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d body=%s", w.Code, w.Body.String())
	}
	if materials.userID != "a6d80cf2-976f-4b2c-8b2e-64fc0d4e77e8" || materials.kind != "image" || materials.keyword != "参考" || materials.page != 2 || materials.pageSize != 12 {
		t.Fatalf("unexpected material query: %#v", materials)
	}
	if !containsString(w.Body.String(), `"file_name":"参考图.png"`) || !containsString(w.Body.String(), `"total":1`) {
		t.Fatalf("unexpected response: %s", w.Body.String())
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

func TestAdminHandlerRejectsProjectUserMismatch(t *testing.T) {
	r := newAdminRouter(true)
	for _, path := range []string{
		"/api/v1/admin/users/96d80cf2-976f-4b2c-8b2e-64fc0d4e77e8/projects/86d80cf2-976f-4b2c-8b2e-64fc0d4e77e8",
		"/api/v1/admin/users/a6d80cf2-976f-4b2c-8b2e-64fc0d4e77e8/projects/96d80cf2-976f-4b2c-8b2e-64fc0d4e77e8/images",
		"/api/v1/admin/users/a6d80cf2-976f-4b2c-8b2e-64fc0d4e77e8/projects/96d80cf2-976f-4b2c-8b2e-64fc0d4e77e8/images/image-a",
	} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusNotFound {
			t.Fatalf("%s: want 404, got %d body=%s", path, w.Code, w.Body.String())
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
