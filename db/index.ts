import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

// In production, use the Vercel-generated POSTGRES_URL
// In development, use the direct DATABASE_URL
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL!

// Disable prefetch as it is not supported for "Transaction" pool mode
const client = postgres(connectionString, {
  prepare: false,
  ssl: {
    rejectUnauthorized: true,
  },
})
export const db = drizzle(client)
