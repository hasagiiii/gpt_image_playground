package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"gpt-image-backend/internal/models"
)

// ErrUserNotFound 当查询不到用户时返回
var ErrUserNotFound = errors.New("user not found")

// UserRepository 用户表访问层
type UserRepository struct {
	db *DB
}

// NewUserRepository 构造一个 UserRepository
func NewUserRepository(db *DB) *UserRepository {
	return &UserRepository{db: db}
}

// FindByOIDC 根据 (provider, sub) 查找用户
func (r *UserRepository) FindByOIDC(ctx context.Context, provider, sub string) (*models.User, error) {
	const q = `
		SELECT id, oidc_provider, oidc_sub, COALESCE(email,''), COALESCE(name,''),
		       COALESCE(picture_url,''), COALESCE(raw_claims,'{}'::jsonb),
		       created_at, updated_at, last_login_at
		FROM users
		WHERE oidc_provider=$1 AND oidc_sub=$2`
	row := r.db.QueryRowContext(ctx, q, provider, sub)
	return scanUser(row)
}

// FindByID 根据主键查找用户
func (r *UserRepository) FindByID(ctx context.Context, id string) (*models.User, error) {
	const q = `
		SELECT id, oidc_provider, oidc_sub, COALESCE(email,''), COALESCE(name,''),
		       COALESCE(picture_url,''), COALESCE(raw_claims,'{}'::jsonb),
		       created_at, updated_at, last_login_at
		FROM users WHERE id=$1`
	row := r.db.QueryRowContext(ctx, q, id)
	return scanUser(row)
}

// List 返回所有用户，供管理员只读查看。
func (r *UserRepository) List(ctx context.Context) ([]models.User, error) {
	const q = `
		SELECT u.id, u.oidc_provider, u.oidc_sub, COALESCE(u.email,''), COALESCE(u.name,''),
		       COALESCE(picture_url,''), COALESCE(raw_claims,'{}'::jsonb),
		       u.created_at, u.updated_at, u.last_login_at,
		       (SELECT MAX(p.content_updated_at) FROM online_projects p
		        WHERE p.user_id = u.id AND p.deleted_at IS NULL)
		FROM users u
		ORDER BY u.last_login_at DESC NULLS LAST, u.created_at DESC, u.id`
	rows, err := r.db.QueryContext(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()
	users := make([]models.User, 0)
	for rows.Next() {
		user, err := scanUserWithProject(rows)
		if err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		users = append(users, *user)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	return users, nil
}

// UpsertFromOIDC 在 OIDC 登录成功后写入或刷新用户资料，并更新 last_login_at
func (r *UserRepository) UpsertFromOIDC(ctx context.Context, u *models.User) (*models.User, error) {
	if u.OIDCProvider == "" || u.OIDCSub == "" {
		return nil, fmt.Errorf("upsert user: provider/sub required")
	}
	now := time.Now().UTC()
	const q = `
		INSERT INTO users (oidc_provider, oidc_sub, email, name, picture_url, raw_claims,
		                   created_at, updated_at, last_login_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$7)
		ON CONFLICT (oidc_provider, oidc_sub) DO UPDATE SET
			email = EXCLUDED.email,
			name = EXCLUDED.name,
			picture_url = EXCLUDED.picture_url,
			raw_claims = EXCLUDED.raw_claims,
			updated_at = EXCLUDED.updated_at,
			last_login_at = EXCLUDED.last_login_at
		RETURNING id, oidc_provider, oidc_sub, COALESCE(email,''), COALESCE(name,''),
		          COALESCE(picture_url,''), COALESCE(raw_claims,'{}'::jsonb),
		          created_at, updated_at, last_login_at`
	row := r.db.QueryRowContext(ctx, q,
		u.OIDCProvider, u.OIDCSub, u.Email, u.Name, u.PictureURL, u.RawClaims, now,
	)
	return scanUser(row)
}

type userScanner interface {
	Scan(dest ...any) error
}

func scanUser(row userScanner) (*models.User, error) {
	return scanUserFields(row, false)
}

func scanUserWithProject(row userScanner) (*models.User, error) {
	return scanUserFields(row, true)
}

func scanUserFields(row userScanner, withProject bool) (*models.User, error) {
	var u models.User
	var lastLogin sql.NullTime
	var lastProject sql.NullTime
	dest := []any{
		&u.ID, &u.OIDCProvider, &u.OIDCSub, &u.Email, &u.Name, &u.PictureURL,
		&u.RawClaims, &u.CreatedAt, &u.UpdatedAt, &lastLogin,
	}
	if withProject {
		dest = append(dest, &lastProject)
	}
	if err := row.Scan(dest...); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	if lastLogin.Valid {
		t := lastLogin.Time
		u.LastLoginAt = &t
	}
	if lastProject.Valid {
		t := lastProject.Time
		u.LastProjectUpdatedAt = &t
	}
	return &u, nil
}
