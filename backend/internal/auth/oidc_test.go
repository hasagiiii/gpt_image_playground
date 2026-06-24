package auth

import (
	"crypto/sha256"
	"encoding/base64"
	"testing"
	"time"
)

func TestNewPKCEPair(t *testing.T) {
	p, err := NewPKCEPair()
	if err != nil {
		t.Fatalf("NewPKCEPair: %v", err)
	}
	if p.Verifier == "" || p.Challenge == "" {
		t.Fatal("expect non-empty pkce fields")
	}
	// challenge 必须是 sha256(verifier) 的 base64url
	sum := sha256.Sum256([]byte(p.Verifier))
	want := base64.RawURLEncoding.EncodeToString(sum[:])
	if p.Challenge != want {
		t.Errorf("challenge mismatch:\n got:  %s\n want: %s", p.Challenge, want)
	}

	// 两次生成应不相同
	p2, _ := NewPKCEPair()
	if p.Verifier == p2.Verifier {
		t.Error("verifier should be random across calls")
	}
}

func TestNewState(t *testing.T) {
	a, err := NewState()
	if err != nil {
		t.Fatalf("NewState: %v", err)
	}
	b, _ := NewState()
	if a == "" || a == b {
		t.Errorf("state should be non-empty and random: %q vs %q", a, b)
	}
}

func TestStateStoreSaveAndConsume(t *testing.T) {
	s := NewStateStore(time.Minute)
	s.Save("state-1", "corp", "verifier-1")

	prov, ver, ok := s.Consume("state-1")
	if !ok {
		t.Fatal("expect Consume ok")
	}
	if prov != "corp" || ver != "verifier-1" {
		t.Errorf("unexpected provider/verifier: %s %s", prov, ver)
	}

	// 再次 consume 应该 false
	if _, _, ok := s.Consume("state-1"); ok {
		t.Fatal("expect second Consume to fail")
	}

	// 不存在的 state
	if _, _, ok := s.Consume("missing"); ok {
		t.Fatal("expect missing state to fail")
	}
}

func TestStateStoreExpired(t *testing.T) {
	s := NewStateStore(10 * time.Millisecond)
	s.Save("state-x", "p", "v")
	time.Sleep(20 * time.Millisecond)
	if _, _, ok := s.Consume("state-x"); ok {
		t.Fatal("expired state should not be consumable")
	}
}
