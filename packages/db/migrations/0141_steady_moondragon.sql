-- Drop deleted_at column if it exists (from 0139)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_table_definitions' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE "user_table_definitions" DROP COLUMN "deleted_at";
  END IF;
END $$;
--> statement-breakpoint
-- Drop row_count column if it exists (from 0139, will be re-added in 0141)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_table_definitions' AND column_name = 'row_count'
  ) THEN
    ALTER TABLE "user_table_definitions" DROP COLUMN "row_count";
  END IF;
END $$;
--> statement-breakpoint
-- Drop the deleted_at index if it exists
DROP INDEX IF EXISTS "user_table_def_deleted_at_idx";
