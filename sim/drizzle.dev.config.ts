import dotenv from 'dotenv'
import type { Config } from 'drizzle-kit'

dotenv.config({ path: '.env.dev' })

export default {
  schema: './db/schema.ts',
  out: './db/migrations-dev',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Use schemaFilter instead of driver.options.schema
  schemaFilter: ['dev_migrations'],
} satisfies Config
