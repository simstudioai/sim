import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

// Check if we're in local storage mode (CLI usage with npx sim)
const isLocalStorage = process.env.USE_LOCAL_STORAGE === 'true'

// Only connect to the database if we're not in local storage mode
let db: ReturnType<typeof drizzle> | null = null

if (!isLocalStorage) {
  // In production, use the Vercel-generated POSTGRES_URL
  // In development, use the direct DATABASE_URL
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL!

  // Disable prefetch as it is not supported for "Transaction" pool mode
  const client = postgres(connectionString, {
    prepare: false,
  })
  db = drizzle(client)
}

// Export the database client or a null value if in local storage mode
export { db }
