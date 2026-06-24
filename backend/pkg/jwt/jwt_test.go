package jwt

import (
	"testing"
	"time"

	"gpt-image-backend/pkg/config"
)

func newTestManager(t *testing.T) *Manager {
	t.Helper()
	return NewManager(config.JWTConfig{
		SecretKey:    "test-secret-key-not-for-prod",
		Issuer:       "test-issuer",
		ExpireHours:  1,
		RefreshHours: 2,
	})
}

func TestIssueAndParse(t *testing.T) {
	mgr := newTestManager(t)

	tokens, err := mgr.IssueTokenPair("user-1", "u@example.com", "Alice", "corp-sso")
	if err != nil {
		t.Fatalf("issue failed: %v", err)
	}
	if tokens.AccessToken == "" || tokens.RefreshToken == "" {
		t.Fatal("expect non-empty tokens")
	}
	if tokens.TokenType != "Bearer" {
		t.Errorf("expect Bearer token type, got %q", tokens.TokenType)
	}
	if tokens.ExpiresIn != 3600 {
		t.Errorf("expect 3600 seconds expires_in, got %d", tokens.ExpiresIn)
	}

	access, err := mgr.ParseAndValidate(tokens.AccessToken)
	if err != nil {
		t.Fatalf("parse access failed: %v", err)
	}
	if access.UserID != "user-1" || access.Email != "u@example.com" || access.Provider != "corp-sso" {
		t.Errorf("unexpected claims: %+v", access)
	}
	if access.Type != "access" {
		t.Errorf("expect access type, got %q", access.Type)
	}

	refresh, err := mgr.ParseAndValidate(tokens.RefreshToken)
	if err != nil {
		t.Fatalf("parse refresh failed: %v", err)
	}
	if refresh.Type != "refresh" {
		t.Errorf("expect refresh type, got %q", refresh.Type)
	}
}

func TestRefreshAccessToken(t *testing.T) {
	mgr := newTestManager(t)
	tokens, err := mgr.IssueTokenPair("u1", "", "", "p")
	if err != nil {
		t.Fatalf("issue failed: %v", err)
	}

	next, err := mgr.RefreshAccessToken(tokens.RefreshToken)
	if err != nil {
		t.Fatalf("refresh failed: %v", err)
	}
	if next.AccessToken == "" || next.RefreshToken == "" {
		t.Fatal("expect new pair")
	}

	// access token 不能用来 refresh
	if _, err := mgr.RefreshAccessToken(tokens.AccessToken); err == nil {
		t.Fatal("expect refresh with access token to fail")
	}
}

func TestParseInvalidToken(t *testing.T) {
	mgr := newTestManager(t)
	if _, err := mgr.ParseAndValidate("garbage"); err == nil {
		t.Fatal("expect error for garbage token")
	}

	// 错误密钥
	other := NewManager(config.JWTConfig{
		SecretKey:   "different-secret",
		Issuer:      "test",
		ExpireHours: 1,
	})
	tokens, _ := mgr.IssueTokenPair("u", "", "", "p")
	if _, err := other.ParseAndValidate(tokens.AccessToken); err == nil {
		t.Fatal("expect error for wrong secret")
	}
}

func TestExpiredToken(t *testing.T) {
	mgr := NewManager(config.JWTConfig{
		SecretKey:    "k",
		Issuer:       "test",
		ExpireHours:  0, // 立即过期
		RefreshHours: 0,
	})
	tok, err := mgr.signToken("u", "", "", "p", "access", -time.Hour)
	if err != nil {
		t.Fatalf("sign failed: %v", err)
	}
	if _, err := mgr.ParseAndValidate(tok); err == nil {
		t.Fatal("expect expired error")
	}
}
