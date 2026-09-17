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

if (import.meta.main) {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Missing DATABASE_URL')
  const sql = postgres(url, { max: 1, connect_timeout: 10 })
  try {
    await prepareForcedPush(sql)
    createLogger('DatabasePush').info('Forced push compatibility preparation completed')
  } finally {
    await sql.end()
  }
}
