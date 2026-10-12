import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Config } from 'drizzle-kit'

const schemaPath = relative(process.cwd(), fileURLToPath(new URL('./schema.ts', import.meta.url)))
const migrationsPath = relative(
  process.cwd(),
  fileURLToPath(new URL('./migrations', import.meta.url))
)

export default {
  schema: schemaPath,
  out: migrationsPath,
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  /** Runner-owned journals and resumable cleanup cursors must survive a development schema push. */
  tablesFilter: [
    '!script_migrations',
    '!search_embedding_cleanup_progress',
    '!search_embedding_cleanup_targets',
    '!search_retirement_*',
    '!embedding_search_retirement_*',
  ],
} satisfies Config
