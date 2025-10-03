import type { ConnectionOptions } from 'node:tls'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export * from './schema'
export type { PostgresJsDatabase }

const connectionString = process.env.DATABASE_URL!
if (!connectionString) {
  throw new Error('Missing DATABASE_URL environment variable')
}

const getSSLConfig = () => {
  const sslMode = process.env.DATABASE_SSL?.toLowerCase()

  if (!sslMode) {
    return undefined
  }

  if (sslMode === 'disable') {
    return false
  }

  if (sslMode === 'prefer') {
    return 'prefer'
  }

  const sslConfig: ConnectionOptions = {}

  if (sslMode === 'require') {
    sslConfig.rejectUnauthorized = false
  } else if (sslMode === 'verify-ca' || sslMode === 'verify-full') {
    sslConfig.rejectUnauthorized = true
    if (process.env.DATABASE_SSL_CA) {
      try {
        const ca = Buffer.from(process.env.DATABASE_SSL_CA, 'base64').toString('utf-8')
        sslConfig.ca = ca
      } catch (error) {
        console.error('Failed to parse DATABASE_SSL_CA:', error)
      }
    }
  } else {
    throw new Error(
      `Invalid DATABASE_SSL mode: ${sslMode}. Must be one of: disable, prefer, require, verify-ca, verify-full`
    )
  }

  return sslConfig
}

const sslConfig = getSSLConfig()
const postgresClient = postgres(connectionString, {
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 30,
  max: 80,
  onnotice: () => {},
  ...(sslConfig !== undefined && { ssl: sslConfig }),
})

const drizzleClient = drizzle(postgresClient, { schema })

declare global {
  // eslint-disable-next-line no-var
  var database: PostgresJsDatabase<typeof schema> | undefined
}

export const db = globalThis.database || drizzleClient
if (process.env.NODE_ENV !== 'production') globalThis.database = db
