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
  /* script_migrations is the one-off-script ledger (script-migrations/index.ts) —
     deliberately managed outside drizzle. Without this filter, dev's `db:push` sees an
     unknown table: it prompts "created or renamed?" (no TTY in CI → red) and would DROP
     the ledger, making every applied one-off script re-run. */
  tablesFilter: ['!script_migrations'],
} satisfies Config
