-- 0014 tightens kb_owner_check after repairing retained legacy rows, then validates both checks.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"knowledge_base"'::regclass
      AND conname = 'kb_organization_search_index_check'
  ) THEN
    ALTER TABLE "knowledge_base" ADD CONSTRAINT "kb_organization_search_index_check"
      CHECK ("organization_id" IS NULL OR "is_search_index") NOT VALID;
  END IF;
END $$;
