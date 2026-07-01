-- 用户表：仅存储来自 OIDC 提供商返回的基本资料
-- 一个 (oidc_provider, oidc_sub) 唯一标识一个第三方账户
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    oidc_provider TEXT NOT NULL,
    oidc_sub      TEXT NOT NULL,
    email         TEXT,
    name          TEXT,
    picture_url   TEXT,
    raw_claims    JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    UNIQUE (oidc_provider, oidc_sub)
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
