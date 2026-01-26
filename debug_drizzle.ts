import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './packages/db/schema'

async function run() {
  const sql = postgres('postgresql://_SYSTEM:SYS@localhost:5435/USER', {
    prepare: false,
    debug: (conn, query, params) => {
      console.log('SQL:', query)
    }
  })
  
  const db = drizzle(sql, { schema })
  
  console.log('--- Drizzle select from workflow_folder ---')
  try {
    const folders = await db.select().from(schema.workflowFolder).limit(1)
    console.log('Drizzle result:', folders)
    if (folders[0]) {
      console.log('Keys:', Object.keys(folders[0]))
      console.log('Values:', Object.values(folders[0]))
      console.log('id:', folders[0].id)
      console.log('name:', folders[0].name)
    }
  } catch (e) {
    console.error('Error:', e)
  }
  
  console.log('\n--- Raw sql query ---')
  const raw = await sql`SELECT "id", "name" FROM "workflow_folder" LIMIT 1`
  console.log('Raw result:', raw)
  if (raw[0]) {
    console.log('Raw Keys:', Object.keys(raw[0]))
    console.log('Raw id:', raw[0].id)
    console.log('Raw name:', raw[0].name)
  }
  
  await sql.end()
}

run().catch(console.error)
