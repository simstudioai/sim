import { createLogger } from '@sim/logger'
import postgres, { type Sql } from 'postgres'

/**
 * Direct schema push does not run versioned SQL migrations. Retire the known
 * size compatibility bridge atomically with its column, preserving canonical
 * bigint values and backfilling legacy-only rows before Drizzle inspects them.
 * Only the explicitly forced push path invokes this preparation; ordinary
 * migrations continue to use the guarded release cutover in migration 0348.
 */
export async function prepareForcedPush(sql: Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '5s'`
    const columns = await tx<{ attname: string }[]>`
      SELECT attname FROM pg_attribute
      WHERE attrelid = to_regclass('public.workspace_files')
        AND attname IN ('size', 'size_bytes') AND NOT attisdropped
    `
    if (!columns.some((column) => column.attname === 'size')) return

    await tx`LOCK TABLE public.workspace_files IN ACCESS EXCLUSIVE MODE`
    await tx`ALTER TABLE public.workspace_files ADD COLUMN IF NOT EXISTS size_bytes bigint`
    await tx`UPDATE public.workspace_files SET size_bytes = size WHERE size_bytes IS NULL`
    await tx`DROP TRIGGER IF EXISTS workspace_files_sync_size_columns ON public.workspace_files`
    await tx`DROP FUNCTION IF EXISTS public.sync_workspace_file_size_columns()`
    await tx`ALTER TABLE public.workspace_files DROP COLUMN size`
  })
}

/** Retires trigger dependencies that Drizzle cannot discover inside PL/pgSQL bodies. */
async function prepareKeywordProjectionRemoval(sql: Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '100ms'`
    await tx`SET LOCAL statement_timeout = '5s'`
    for (const [table, trigger] of [
      ['knowledge_base', 'knowledge_base_keyword_search_sync'],
      ['embedding', 'embedding_keyword_search_sync'],
    ]) {
      const [relation] = await tx<{ present: boolean }[]>`
        SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS present
      `
      if (!relation.present) continue
      await tx.unsafe(`LOCK TABLE public.${table} IN SHARE ROW EXCLUSIVE MODE NOWAIT`)
      await tx.unsafe(`DROP TRIGGER IF EXISTS ${trigger} ON public.${table}`)
    }
    await tx`DROP FUNCTION IF EXISTS public.sync_embedding_keyword_search(),
      public.sync_knowledge_base_keyword_search() RESTRICT`
  })
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Missing DATABASE_URL')
  const sql = postgres(url, { max: 1, connect_timeout: 10 })
  try {
    if (process.argv.includes('--force')) await prepareForcedPush(sql)
    await prepareKeywordProjectionRemoval(sql)
    createLogger('DatabasePush').info('Schema push compatibility preparation completed')
  } finally {
    await sql.end()
  }
}
