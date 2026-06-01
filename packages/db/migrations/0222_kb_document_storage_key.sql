-- ============================================================================
-- Knowledge-base file-access authorization: document.storage_key + backfill
-- ============================================================================
-- Adds document.storage_key (the canonical kb/ key KB file authorization matches
-- on at read time), then two data steps: (1) populate storage_key from file_url
-- for existing rows; (2) backfill trusted ownership bindings into workspace_files
-- (context 'knowledge-base') for pre-existing kb/ objects, derived from the
-- populated storage_key.
--
-- Lock profile (mirrors 0220_early_hellion.sql): the ADD COLUMN runs in the
-- migration transaction, then COMMIT releases the ACCESS EXCLUSIVE lock so the
-- row-by-row backfill runs in bounded batches (committing every 5000 rows) and
-- the index is built CONCURRENTLY — no full read/write lockout on `document`.
--
-- Ownership is derived conservatively (anti-poisoning):
--   * Only active documents (not excluded/archived/deleted, in a live KB) count.
--   * A key referenced by documents in more than one workspace is ambiguous and
--     skipped (deny-by-default).
--   * Within a single workspace the earliest uploader wins.
--   * Keys with an existing active binding are skipped (idempotent; ON CONFLICT
--     DO NOTHING guards the active-key unique index against a concurrent insert).
--
-- IMPORTANT — run these read-only pre-flight checks on the DB console and
-- remediate (exclude/delete) any rows BEFORE applying this migration. The
-- multi-workspace guard catches contested keys, but a pre-existing plant that is
-- the sole referencer of an orphan key can only be caught by check (2).
--
-- (1) Multi-workspace keys — same kb/ object referenced by documents in >1 workspace:
--   WITH kb_docs AS (
--     SELECT d.id AS document_id, kb.workspace_id,
--       regexp_replace(replace(replace(
--         substring(split_part(d.file_url, '?', 1) FROM '/api/files/serve/(.*)$'),
--         '%2F','/'),'%2f','/'),'^(s3|blob)/','') AS storage_key
--     FROM document d JOIN knowledge_base kb ON kb.id = d.knowledge_base_id
--     WHERE d.user_excluded = false AND d.archived_at IS NULL
--       AND d.deleted_at IS NULL AND kb.deleted_at IS NULL
--   )
--   SELECT * FROM kb_docs WHERE storage_key LIKE 'kb/%' AND storage_key IN (
--     SELECT storage_key FROM kb_docs
--     WHERE storage_key LIKE 'kb/%' AND workspace_id IS NOT NULL
--     GROUP BY storage_key HAVING COUNT(DISTINCT workspace_id) > 1)
--   ORDER BY storage_key;
--
-- (2) Cross-origin serve URLs — foreign host mimicking the serve path. Replace
--     'your-app-host' with your deployment host(s):
--   SELECT d.id, kb.workspace_id, d.file_url,
--     substring(split_part(d.file_url, '?', 1) FROM '^https?://([^/]+)') AS url_host
--   FROM document d JOIN knowledge_base kb ON kb.id = d.knowledge_base_id
--   WHERE d.user_excluded = false AND d.archived_at IS NULL
--     AND d.deleted_at IS NULL AND kb.deleted_at IS NULL
--     AND split_part(d.file_url, '?', 1) ~ '/api/files/serve/(s3/|blob/)?kb(/|%2F)'
--     AND substring(split_part(d.file_url, '?', 1) FROM '^https?://([^/]+)')
--         NOT IN ('your-app-host')
--   ORDER BY url_host;

ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "storage_key" text;--> statement-breakpoint
COMMIT;--> statement-breakpoint

-- (1) Populate storage_key from file_url for existing documents, in bounded
-- batches. Only internal serve URLs are touched; external/data: URLs keep NULL.
CREATE OR REPLACE PROCEDURE backfill_document_storage_key_0222() LANGUAGE plpgsql AS $$
DECLARE
  updated integer;
BEGIN
  LOOP
    WITH candidates AS (
      SELECT id FROM document
      WHERE storage_key IS NULL
        AND file_url LIKE '%/api/files/serve/%'
      LIMIT 5000
    )
    UPDATE document d
    SET storage_key = regexp_replace(
      replace(
        replace(
          substring(split_part(d.file_url, '?', 1) FROM '/api/files/serve/(.*)$'),
          '%2F', '/'
        ),
        '%2f', '/'
      ),
      '^(s3|blob)/',
      ''
    )
    FROM candidates c
    WHERE d.id = c.id;
    GET DIAGNOSTICS updated = ROW_COUNT;
    EXIT WHEN updated = 0;
    COMMIT;
  END LOOP;
END;
$$;--> statement-breakpoint
CALL backfill_document_storage_key_0222();--> statement-breakpoint
DROP PROCEDURE backfill_document_storage_key_0222();--> statement-breakpoint

CREATE INDEX CONCURRENTLY IF NOT EXISTS "doc_storage_key_idx" ON "document" USING btree ("storage_key") WHERE "storage_key" IS NOT NULL;--> statement-breakpoint

-- (2) Backfill workspace_files ownership bindings from the populated storage_key.
WITH kb_docs AS (
	SELECT
		d."uploaded_at" AS uploaded_at,
		kb."workspace_id" AS workspace_id,
		kb."user_id" AS user_id,
		d."storage_key" AS storage_key
	FROM "document" d
	INNER JOIN "knowledge_base" kb ON kb."id" = d."knowledge_base_id"
	WHERE d."user_excluded" = false
		AND d."archived_at" IS NULL
		AND d."deleted_at" IS NULL
		AND kb."deleted_at" IS NULL
		AND kb."workspace_id" IS NOT NULL
		AND d."storage_key" LIKE 'kb/%'
),
kb_keys AS (
	SELECT storage_key
	FROM kb_docs
	GROUP BY storage_key
	HAVING COUNT(DISTINCT workspace_id) = 1
),
owners AS (
	SELECT DISTINCT ON (kb_docs.storage_key)
		kb_docs.storage_key AS storage_key,
		kb_docs.workspace_id AS workspace_id,
		kb_docs.user_id AS user_id
	FROM kb_docs
	INNER JOIN kb_keys ON kb_keys.storage_key = kb_docs.storage_key
	ORDER BY kb_docs.storage_key, kb_docs.uploaded_at ASC
)
INSERT INTO "workspace_files" (
	"id",
	"key",
	"user_id",
	"workspace_id",
	"context",
	"original_name",
	"content_type",
	"size"
)
SELECT
	gen_random_uuid()::text,
	owners.storage_key,
	owners.user_id,
	owners.workspace_id,
	'knowledge-base',
	regexp_replace(owners.storage_key, '^.*/', ''),
	'application/octet-stream',
	0
FROM owners
WHERE NOT EXISTS (
	SELECT 1
	FROM "workspace_files" wf
	WHERE wf."key" = owners.storage_key
		AND wf."deleted_at" IS NULL
)
ON CONFLICT DO NOTHING;
