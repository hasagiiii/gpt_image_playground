ALTER TABLE online_projects
    DROP COLUMN IF EXISTS output_image_count,
    DROP COLUMN IF EXISTS output_image_count_sha256;
