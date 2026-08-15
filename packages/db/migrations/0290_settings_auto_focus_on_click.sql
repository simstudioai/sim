-- migration-safe: an additive column with a non-null default, so old and new app versions read and write these rows throughout the deploy. Defaulting to true preserves the camera-follows-click behavior every released version already ships.
ALTER TABLE "settings" ADD COLUMN "auto_focus_on_click" boolean DEFAULT true NOT NULL;
