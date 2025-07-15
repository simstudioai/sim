import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/lib/env'
import { isDev } from '@/lib/environment'
import * as schema from './schema'

// In production, use the Vercel-generated POSTGRES_URL
// In development, use the direct DATABASE_URL
const connectionString = env.POSTGRES_URL ?? env.DATABASE_URL

/**
 * Connection Pool Allocation Strategy
 *
 * Main App: 25 connections per instance
 * Socket Server: 3 connections total
 *
 * With ~3-4 Vercel serverless instances typically active:
 * - Main app: 25 × 4 = 100 connections
 * - Socket server: 3 connections
 * - Buffer: 25 connections
 * - Total: ~128 connections
 * - Supabase limit: 128 connections (16XL instance)
 */

const postgresClient = postgres(connectionString, {
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 30,
  max: 25,
  onnotice: () => {},
})

const drizzleClient = drizzle(postgresClient, { schema })

declare global {
  var database: PostgresJsDatabase<typeof schema> | undefined
}

export const db = global.database || drizzleClient
if (isDev) global.database = db
