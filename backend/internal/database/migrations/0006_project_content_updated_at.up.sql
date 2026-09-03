-- updated_at 会被视口保存等非内容变更刷新，无法表示“最后修改”。
-- 新增 content_updated_at 只在内容真正变化时更新，存量数据用 updated_at 回填。
ALTER TABLE online_projects
    ADD COLUMN IF NOT EXISTS content_updated_at TIMESTAMPTZ;

UPDATE online_projects
SET content_updated_at = updated_at
WHERE content_updated_at IS NULL;

ALTER TABLE online_projects
    ALTER COLUMN content_updated_at SET DEFAULT NOW();

ALTER TABLE online_projects
    ALTER COLUMN content_updated_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_online_projects_user_content_updated
    ON online_projects (user_id, content_updated_at DESC)
    WHERE deleted_at IS NULL;
