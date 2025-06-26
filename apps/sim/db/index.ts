import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/lib/env'
import * as schema from './schema'

// In production, use the Vercel-generated POSTGRES_URL
// In development, use the direct DATABASE_URL
const connectionString = env.POSTGRES_URL ?? env.DATABASE_URL

const drizzleClient = drizzle(
  postgres(connectionString, {
    prepare: false, // Disable prefetch as it is not supported for "Transaction" pool mode
    idle_timeout: 30, // Keep connections alive for 30 seconds when idle
    connect_timeout: 30, // Timeout after 30 seconds when connecting
  }),
  { schema }
)

declare global {
  var database: PostgresJsDatabase<typeof schema> | undefined
}

export const db = global.database || drizzleClient
if (process.env.NODE_ENV !== 'production') global.database = db
