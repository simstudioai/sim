import type { Config } from 'drizzle-kit'
import { env } from './lib/env'

export default {
  schema: '../../packages/db/schema.ts',
  out: '../../packages/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
} satisfies Config
