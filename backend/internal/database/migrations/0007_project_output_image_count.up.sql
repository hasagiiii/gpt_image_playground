-- 统计值绑定归档摘要，旧项目及归档更新后在下次读取列表时重新计算。
ALTER TABLE online_projects
    ADD COLUMN IF NOT EXISTS output_image_count BIGINT,
    ADD COLUMN IF NOT EXISTS output_image_count_sha256 TEXT;
