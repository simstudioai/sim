-- Add row_count column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_table_definitions' AND column_name = 'row_count'
  ) THEN
    ALTER TABLE "user_table_definitions" ADD COLUMN "row_count" integer DEFAULT 0 NOT NULL;
  END IF;
END $$;
--> statement-breakpoint
-- Backfill existing row counts
UPDATE user_table_definitions t
SET row_count = (
  SELECT COUNT(*)
  FROM user_table_rows r
  WHERE r.table_id = t.id
);
--> statement-breakpoint
-- Create function to increment row count on insert
CREATE OR REPLACE FUNCTION increment_table_row_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE user_table_definitions
  SET row_count = row_count + 1
  WHERE id = NEW.table_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Create trigger for insert
CREATE TRIGGER trg_increment_row_count
AFTER INSERT ON user_table_rows
FOR EACH ROW
EXECUTE FUNCTION increment_table_row_count();
--> statement-breakpoint
-- Create function to decrement row count on delete
CREATE OR REPLACE FUNCTION decrement_table_row_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE user_table_definitions
  SET row_count = GREATEST(0, row_count - 1)
  WHERE id = OLD.table_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Create trigger for delete
CREATE TRIGGER trg_decrement_row_count
AFTER DELETE ON user_table_rows
FOR EACH ROW
EXECUTE FUNCTION decrement_table_row_count();