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
  connect_timeout: 10,
  max: 20,
  onnotice: () => {},
})

export const db = drizzle(postgresClient, { schema })
