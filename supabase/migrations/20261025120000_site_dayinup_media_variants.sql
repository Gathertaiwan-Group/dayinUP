-- Responsive WebP variants (480/960/1440w, quality 75, never upscaled) stored at site-dayinup/v/<w>/<storage_path>
-- variants = [{ "w": 480, "h": 270, "path": "v/480/uploads/2025/05/x.webp", "bytes": 12345 }, ...] (ascending w)
alter table site_dayinup.media add column if not exists variants jsonb not null default '[]'::jsonb;
