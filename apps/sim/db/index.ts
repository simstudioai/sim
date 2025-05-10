import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

// In production, use the Vercel-generated POSTGRES_URL
// In development, use the direct DATABASE_URL
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL!

// Disable prefetch as it is not supported for "Transaction" pool mode
const client = postgres(connectionString, {
  prepare: false,
  idle_timeout: 30, // Keep connections alive for 30 seconds when idle
  connect_timeout: 30, // Timeout after 30 seconds when connecting
})

// Export the database client (never null)
export const db = drizzle(client)
