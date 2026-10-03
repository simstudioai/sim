-- migration-safe: 0321 installed and validated embedding_width_check, which requires exactly one supported vector column. Removing the original 1536-only NOT NULL restriction preserves existing rows and legacy writers while permitting the other widths already supported by the application.
ALTER TABLE "embedding" ALTER COLUMN "embedding" DROP NOT NULL;
