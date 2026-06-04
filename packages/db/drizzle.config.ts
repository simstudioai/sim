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
} satisfies Config
