import postgres from 'postgres'

async function run() {
  const sql = postgres('postgresql://_SYSTEM:SYS@localhost:5435/USER', {
    prepare: false,
  })
  
  console.log('--- Template literal query (what works) ---')
  const r1 = await sql`SELECT "id", "name" FROM "workflow_folder" LIMIT 1`
  console.log('Result:', r1[0])
  
  console.log('\n--- sql.unsafe with parameter (what Drizzle uses) ---')
  const r2 = await sql.unsafe('SELECT "id", "name" FROM "workflow_folder" LIMIT $1', [1])
  console.log('Result:', r2[0])
  console.log('Keys:', Object.keys(r2[0] || {}))
  console.log('Values:', Object.values(r2[0] || {}))
  
  console.log('\n--- sql.unsafe without parameter ---')
  const r3 = await sql.unsafe('SELECT "id", "name" FROM "workflow_folder" LIMIT 1')
  console.log('Result:', r3[0])
  console.log('Keys:', Object.keys(r3[0] || {}))
  console.log('Values:', Object.values(r3[0] || {}))
  
  await sql.end()
}

run().catch(console.error)
