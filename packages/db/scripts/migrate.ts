import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('ERROR: Missing DATABASE_URL environment variable.')
  console.error('Ensure packages/db/.env is configured.')
  process.exit(1)
}

const client = postgres(url, { max: 1, connect_timeout: 10 })

try {
  await migrate(drizzle(client), { migrationsFolder: './migrations' })
  console.log('Migrations applied successfully.')
} catch (error) {
  console.error('ERROR: Migration failed.')
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
} finally {
  await client.end()
}
