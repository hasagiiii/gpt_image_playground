package jwt

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v4"

	"gpt-image-backend/pkg/config"
)

// Claims 自定义声明
type Claims struct {
	UserID   string `json:"user_id"`
	Email    string `json:"email,omitempty"`
	Name     string `json:"name,omitempty"`
	Provider string `json:"provider,omitempty"`
	Type     string `json:"type"` // "access" 或 "refresh"
	jwt.RegisteredClaims
}

// Manager 负责 JWT 的签发与校验
type Manager struct {
	cfg config.JWTConfig
}

// NewManager 创建 JWT Manager
func NewManager(cfg config.JWTConfig) *Manager {
	return &Manager{cfg: cfg}
}

// TokenPair access token + refresh token
type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`            // 单位：秒，access token 寿命
	TokenType    string `json:"token_type,omitempty"`  // 固定 "Bearer"
}

// IssueTokenPair 为指定用户签发 access + refresh
func (m *Manager) IssueTokenPair(userID, email, name, provider string) (*TokenPair, error) {
	access, err := m.signToken(userID, email, name, provider, "access",
		time.Duration(m.cfg.ExpireHours)*time.Hour)
	if err != nil {
		return nil, err
	}
	refresh, err := m.signToken(userID, email, name, provider, "refresh",
		time.Duration(m.cfg.RefreshHours)*time.Hour)
	if err != nil {
		return nil, err
	}
	return &TokenPair{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresIn:    m.cfg.ExpireHours * 3600,
		TokenType:    "Bearer",
	}, nil
}

func (m *Manager) signToken(userID, email, name, provider, typ string, lifetime time.Duration) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID:   userID,
		Email:    email,
		Name:     name,
		Provider: provider,
		Type:     typ,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    m.cfg.Issuer,
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(lifetime)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(m.cfg.SecretKey))
	if err != nil {
		return "", fmt.Errorf("sign jwt: %w", err)
	}
	return signed, nil
}

// ParseAndValidate 校验签名/有效期，返回解析后的 Claims
func (m *Manager) ParseAndValidate(tokenStr string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(m.cfg.SecretKey), nil
	})
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

// RefreshAccessToken 用 refresh token 换新的 access token
func (m *Manager) RefreshAccessToken(refreshToken string) (*TokenPair, error) {
	claims, err := m.ParseAndValidate(refreshToken)
	if err != nil {
		return nil, err
	}
	if claims.Type != "refresh" {
		return nil, errors.New("token is not a refresh token")
	}
	return m.IssueTokenPair(claims.UserID, claims.Email, claims.Name, claims.Provider)
}
