import type { Config } from 'drizzle-kit'
import { env } from './lib/env'

export default {
  schema: 'apps/sim/db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
} satisfies Config
