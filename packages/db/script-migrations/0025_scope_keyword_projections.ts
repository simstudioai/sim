import {
  installMembershipKey,
  installTinChunkSync,
  installTinMembershipSync,
} from '@sim/db/script-migrations/0019_tin_keyword_projection'
import { resolveMigrationDatabaseUrl } from '@sim/db/script-migrations/database-url'
import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { createLogger } from '@sim/logger'
import postgres, { type Sql, type TransactionSql } from 'postgres'
import { retryOnLockTimeout } from '../scripts/lock-timeout-retry'

const logger = createLogger('ScopeKeywordProjections')

/** Each attempt's wait for the table locks the triggers need; the retries find a quiet moment. */
const TRIGGER_LOCK_TIMEOUT = '5s'
const TRIGGER_LOCK_RETRY_BUDGET_MS = 20 * 60_000
const TRIGGER_LOCK_RETRY_BACKOFF = { baseMs: 2_000, maxMs: 30_000 } as const

/** The columns a GIN keyword row copies from its chunk. */
const KEYWORD_SEARCH_COLUMNS = [
  'knowledge_base_id',
  'document_id',
  'enabled',
  'content_tsv',
] as const

/**
 * How both GIN keyword writers bring an existing row (aliased `s`) up to its chunk. A row already
 * current is left unwritten, as the projector's upserts leave it, so adopting a base whose rows
 * survived rewrites only what changed while it holds the membership lock.
 */
const KEYWORD_SEARCH_UPSERT = `ON CONFLICT (id) DO UPDATE SET
        ${KEYWORD_SEARCH_COLUMNS.map((column) => `${column} = EXCLUDED.${column}`).join(', ')}
      WHERE (${KEYWORD_SEARCH_COLUMNS.map((column) => `s.${column}`).join(', ')})
        IS DISTINCT FROM (${KEYWORD_SEARCH_COLUMNS.map((column) => `EXCLUDED.${column}`).join(', ')})`

/**
 * The GIN keyword projection's chunk trigger, scoped to search indexes as the Tin projection is:
 * it shares the base's membership lock before reading the marker, so a marker change in flight is
 * waited for and read under a fresh snapshot. A chunk outside a search index writes nothing, and an
 * update removes a row it left behind by moving out of one.
 */
async function installKeywordSearchSync(tx: TransactionSql): Promise<void> {
  await tx.unsafe(`CREATE OR REPLACE FUNCTION sync_embedding_keyword_search()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock_shared(knowledge_tin_membership_key(NEW.knowledge_base_id));
      IF NOT EXISTS (
        SELECT 1 FROM knowledge_base WHERE id = NEW.knowledge_base_id AND is_search_index
      ) THEN
        IF TG_OP = 'UPDATE' THEN
          DELETE FROM embedding_keyword_search WHERE id = NEW.id;
        END IF;
        RETURN NEW;
      END IF;
      INSERT INTO embedding_keyword_search AS s (id, knowledge_base_id, document_id, enabled, content_tsv)
      VALUES (NEW.id, NEW.knowledge_base_id, NEW.document_id, NEW.enabled, NEW.content_tsv)
      ${KEYWORD_SEARCH_UPSERT};
      RETURN NEW;
    END;
    $$`)
}

/**
 * Projects or removes a whole base's GIN keyword rows when its search-index marker changes, under
 * the membership lock taken exclusively, as the Tin projection's knowledge base trigger does. It is
 * its own trigger because that one exists only where Tin is installed. The chunks are key-share
 * locked as they are read, as the projection backfills lock theirs: a chunk delete in flight is
 * waited for and its chunk skipped, rather than failing the adoption on the row's foreign key.
 */
async function installKeywordSearchMembership(tx: TransactionSql): Promise<void> {
  await tx.unsafe(`CREATE OR REPLACE FUNCTION sync_knowledge_base_keyword_search()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock(knowledge_tin_membership_key(NEW.id));
      IF NOT NEW.is_search_index THEN
        DELETE FROM embedding_keyword_search WHERE knowledge_base_id = NEW.id;
        RETURN NEW;
      END IF;
      INSERT INTO embedding_keyword_search AS s (id, knowledge_base_id, document_id, enabled, content_tsv)
      SELECT id, knowledge_base_id, document_id, enabled, content_tsv
      FROM embedding WHERE knowledge_base_id = NEW.id
      ORDER BY id FOR KEY SHARE
      ${KEYWORD_SEARCH_UPSERT};
      RETURN NEW;
    END;
    $$`)
  await tx.unsafe(`CREATE OR REPLACE TRIGGER knowledge_base_keyword_search_sync
    AFTER UPDATE OF is_search_index ON knowledge_base
    FOR EACH ROW WHEN (OLD.is_search_index IS DISTINCT FROM NEW.is_search_index)
    EXECUTE FUNCTION sync_knowledge_base_keyword_search()`)
}

/**
 * The Tin trigger bodies as `0019_tin_keyword_projection` now installs them, where that migration
 * installed them: the chunk trigger without the delete an insert outside a search index ran, and
 * the knowledge base trigger key-share locking the chunks it projects.
 */
async function installTinSync(tx: TransactionSql): Promise<void> {
  const [row] = await tx<Array<{ installed: boolean }>>`
    SELECT to_regprocedure('sync_embedding_keyword_tin()') IS NOT NULL AS installed`
  if (!row?.installed) return
  await installTinChunkSync(tx)
  await installTinMembershipSync(tx)
}

/**
 * The document trigger, firing only on an update that changes the source or ACL. An inserted
 * document has no chunks yet, since a chunk's foreign key needs its document, so the fan-out it
 * ran matched no row and it marked nothing; an upsert that updates still fires the update arm. Its
 * body is the one `0024_knowledge_projection_async` installed.
 */
async function installDocumentTrigger(tx: TransactionSql): Promise<void> {
  await tx.unsafe(`CREATE OR REPLACE TRIGGER projection_source_acl_sync
    AFTER UPDATE OF connector_id, acl ON document
    FOR EACH ROW WHEN (OLD.connector_id IS DISTINCT FROM NEW.connector_id OR OLD.acl IS DISTINCT FROM NEW.acl)
    EXECUTE FUNCTION sync_projection_source_acl()`)
}

/**
 * Keeps the keyword projections for search indexes only, the bases whose keyword rows indexed
 * organization search ranks; every other search ranks keywords on `embedding`. Membership follows
 * `knowledge_base.is_search_index` rather than the deployment's search mode, so the schema holds
 * whichever mode runs. The document trigger stops firing on inserts and on updates that change
 * nothing it carries.
 *
 * Rows already written for other bases, and those a rerun of `0016_backfill_search_vectors` writes
 * before this reruns after it, are left in place: nothing reads them, and removing them is a table
 * owner's maintenance, not a deploy's. All of it is installed in one transaction, so no marker change sees
 * the scoped chunk trigger without the base trigger that backfills it. Each attempt waits at most
 * {@link TRIGGER_LOCK_TIMEOUT} for the trigger DDL's locks and is retried within the budget.
 * Idempotent.
 */
export async function scopeKeywordProjections(sql: Sql): Promise<void> {
  await retryOnLockTimeout(
    () =>
      sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL lock_timeout = '${TRIGGER_LOCK_TIMEOUT}'`)
        await installMembershipKey(tx)
        await installKeywordSearchSync(tx)
        await installKeywordSearchMembership(tx)
        await installTinSync(tx)
        await installDocumentTrigger(tx)
      }),
    {
      budgetMs: TRIGGER_LOCK_RETRY_BUDGET_MS,
      backoff: TRIGGER_LOCK_RETRY_BACKOFF,
      onRetry: ({ attempt, delayMs }) =>
        logger.warn('Keyword projection triggers waited out their lock timeout; retrying', {
          attempt,
          retryInMs: Math.round(delayMs),
        }),
    }
  )
}

export const scopeKeywordProjectionsMigration: ScriptMigration = {
  name: '0025_scope_keyword_projections',
  up: scopeKeywordProjections,
}

/** Run directly by `db:push`, after the projection migrations it builds on. */
if (import.meta.main) {
  const url = resolveMigrationDatabaseUrl()
  if (!url) throw new Error('DATABASE_URL is required to scope the keyword projections')
  const sql = postgres(url, { max: 1, max_lifetime: null, onnotice: () => undefined })
  try {
    await scopeKeywordProjections(sql)
  } finally {
    await sql.end()
  }
}
