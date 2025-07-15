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
 * Main App: 60 connections per instance
 * Socket Server: 25 connections (operations) + 5 connections (room manager) = 30 total
 *
 * With ~3-4 Vercel serverless instances typically active:
 * - Main app: 60 × 4 = 240 connections
 * - Socket server: 30 connections total
 * - Buffer: 130 connections
 * - Total: ~400 connections
 * - Supabase limit: 400 connections (16XL instance direct connection pool)
 */

const postgresClient = postgres(connectionString, {
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 30,
  max: 60,
  onnotice: () => {},
})

const drizzleClient = drizzle(postgresClient, { schema })

declare global {
  var database: PostgresJsDatabase<typeof schema> | undefined
}

export const db = global.database || drizzleClient
if (isDev) global.database = db
