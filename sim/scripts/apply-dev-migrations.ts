import * as dotenv from 'dotenv'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

dotenv.config({ path: '.env.dev' })

async function main() {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false })

  // Set the search path to our dev schema
  await client.query('CREATE SCHEMA IF NOT EXISTS dev_migrations;')
  await client.query('SET search_path TO dev_migrations;')

  const db = drizzle(client)

  // Apply migrations
  await migrate(db, { migrationsFolder: './db/migrations-dev' })

  await client.end()
  console.log('Migrations applied successfully to dev_migrations schema')
}

main().catch(console.error)
