import fs from 'fs'
import path from 'path'
import postgres from 'postgres'

async function run() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is missing')

  const sqlFile = path.resolve(__dirname, '../packages/db/migrations_iris/0000_iris_init.sql')
  const content = fs.readFileSync(sqlFile, 'utf8')
  const statements = content.split('--> statement-breakpoint')

  console.log(`Applying ${statements.length} statements to IRIS...`)

  const sql = postgres(databaseUrl, {
    prepare: false,
    fetch_types: false, // Skip pg_type introspection for IRIS
    max: 1,
    idle_timeout: 5,
    parameters: {
      search_path: 'SQLUser, drizzle, public',
    },
  } as any)

  try {
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i].trim()
      if (!statement) continue

      console.log(`[${i + 1}/${statements.length}] Executing statement...`)
      try {
        await sql.unsafe(statement)
        // Small delay to let IRIS/bridge breathe
        await new Promise((resolve) => setTimeout(resolve, 50))
      } catch (err) {
        const msg = (err as any).message || ''
        if (
          msg.includes('already exists') ||
          msg.includes('already defined') ||
          msg.includes('already has index')
        ) {
          console.log(`  [OK] Already exists, skipping`)
          continue
        }
        console.error(`Error in statement ${i + 1}:`, err)
        process.exit(1)
      }
    }
    console.log('Migration applied successfully')
  } finally {
    await sql.end()
  }
}

run().catch(console.error)
