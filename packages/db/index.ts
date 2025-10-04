import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export * from './schema'
export type { PostgresJsDatabase }

const connectionString = process.env.DATABASE_URL!
if (!connectionString) {
  throw new Error('Missing DATABASE_URL environment variable')
}

const postgresClient = postgres(connectionString, {
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 30,
  max: 80,
  onnotice: () => {},
})

const drizzleClient = drizzle(postgresClient, { schema })

declare global {
  // eslint-disable-next-line no-var
  var database: PostgresJsDatabase<typeof schema> | undefined
}

export const db = globalThis.database || drizzleClient
if (process.env.NODE_ENV !== 'production') globalThis.database = db
