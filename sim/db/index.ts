import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Check if we're in local storage mode (CLI usage with npx simstudio)
const isLocalStorage = process.env.USE_LOCAL_STORAGE === 'true'

// Initialize the database client
let client: ReturnType<typeof postgres>
let db: ReturnType<typeof drizzle<typeof schema>>

if (!isLocalStorage) {
  // In production, use the Vercel-generated POSTGRES_URL
  // In development, use the direct DATABASE_URL
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL!

  // Disable prefetch as it is not supported for "Transaction" pool mode
  client = postgres(connectionString, {
    prepare: false,
    idle_timeout: 30, // Keep connections alive for 30 seconds when idle
    connect_timeout: 30, // Timeout after 30 seconds when connecting
  })
  db = drizzle(client, { schema })
} else {
  // Use mock implementation in localStorage mode
  db = {} as ReturnType<typeof drizzle<typeof schema>>
}

// Export the database client (never null)
export { db }
