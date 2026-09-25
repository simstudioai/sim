import type { ScriptMigration } from '@sim/db/script-migrations/types'

/** SQL pages preserve content revisions, storage keys, and ownership, including archived uploads. */
export const backfillFileDiscoveryMigration: ScriptMigration = {
  name: '0025_backfill_file_discovery',
  async up(sql) {
    let afterId = ''
    for (;;) {
      const page = await sql<{ id: string }[]>`
        SELECT id FROM workspace_files WHERE id > ${afterId} ORDER BY id LIMIT 1000
      `
      if (page.length === 0) return
      await sql`
        UPDATE workspace_files SET discovery = 'unlisted'
        WHERE id = ANY(${page.map((row) => row.id)}::text[])
          AND context <> 'workspace' AND discovery = 'listed'
      `
      afterId = page[page.length - 1].id
    }
  },
}
