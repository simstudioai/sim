import type { Config } from 'drizzle-kit'
import { env } from './lib/env'

const connectionString = env.POSTGRES_URL ?? env.DATABASE_URL

let sslConfig: { rejectUnauthorized: boolean; ca: string } | undefined
if (env.DATABASE_SSL_CERT) {
  sslConfig = { rejectUnauthorized: true, ca: env.DATABASE_SSL_CERT }
}

export default {
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: connectionString,
    ssl: sslConfig,
  },
} satisfies Config
