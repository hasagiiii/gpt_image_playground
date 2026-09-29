ALTER TABLE project_images
    ADD COLUMN IF NOT EXISTS image_data BYTEA;
