import type { Config } from 'drizzle-kit'
import { env } from './lib/env'

export default {
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
    ssl: env.DATABASE_SSL_CERT
      ? {
          rejectUnauthorized: true,
          ca: env.DATABASE_SSL_CERT,
        }
      : undefined,
  },
} satisfies Config
