import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export * from './schema'
export type { PostgresJsDatabase }

const connectionString = process.env.DATABASE_URL!
if (!connectionString) {
  throw new Error('Missing DATABASE_URL environment variable')
}

console.log(
  '[DB Pool Init]',
  JSON.stringify({
    timestamp: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV,
    action: 'CREATING_CONNECTION_POOL',
    poolConfig: {
      max: 30,
      idle_timeout: 20,
      connect_timeout: 30,
      prepare: false,
    },
    pid: process.pid,
    isProduction: process.env.NODE_ENV === 'production',
  })
)

const postgresClient = postgres(connectionString, {
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 30,
  max: 30,
  onnotice: () => {},
})

export const db = drizzle(postgresClient, { schema })
