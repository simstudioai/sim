import * as dotenv from 'dotenv'
import type { Config } from 'drizzle-kit'

dotenv.config({ path: '../../.env' })

export default {
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config
