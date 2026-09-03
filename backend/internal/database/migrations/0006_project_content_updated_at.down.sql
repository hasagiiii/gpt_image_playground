DROP INDEX IF EXISTS idx_online_projects_user_content_updated;

ALTER TABLE online_projects
    DROP COLUMN IF EXISTS content_updated_at;
