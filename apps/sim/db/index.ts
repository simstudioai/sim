import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/lib/env'
import * as schema from './schema'

// In production, use the Vercel-generated POSTGRES_URL
// In development, use the direct DATABASE_URL
const connectionString = env.POSTGRES_URL ?? env.DATABASE_URL

/**
 * Connection Pool Allocation Strategy
 *
 * Main App (this file): 3 connections per instance
 * Socket Server Operations: 2 connections
 * Socket Server Room Manager: 1 connection
 *
 * With ~3-4 Vercel serverless instances typically active:
 * - Main app: 3 × 4 = 12 connections
 * - Socket server: 2 + 1 = 3 connections
 * - Buffer: 5 connections for spikes/other services
 * - Total: ~20 connections (at capacity limit)
 *
 * This conservative allocation prevents pool exhaustion while maintaining performance.
 */

const postgresClient = postgres(connectionString, {
  prepare: false, // Disable prefetch as it is not supported for "Transaction" pool mode
  idle_timeout: 20, // Reduce idle timeout to 20 seconds to free up connections faster
  connect_timeout: 30, // Increase connect timeout to 30 seconds to handle network issues
  max: 2, // Further reduced limit to prevent Supabase connection exhaustion
  onnotice: () => {}, // Disable notices to reduce noise
})

const drizzleClient = drizzle(postgresClient, { schema })

declare global {
  var database: PostgresJsDatabase<typeof schema> | undefined
}

export const db = global.database || drizzleClient
if (process.env.NODE_ENV !== 'production') global.database = db
