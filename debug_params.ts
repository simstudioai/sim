import postgres from 'postgres'

async function run() {
  const sql = postgres('postgresql://_SYSTEM:SYS@localhost:5435/USER', {
    prepare: false,
  })
  
  // First check what exists
  console.log('--- Existing folders ---')
  const existing = await sql.unsafe('SELECT "id", "name" FROM "workflow_folder"')
  console.log('Count:', existing.length)
  if (existing[0]) {
    console.log('First folder id:', existing[0].id)
    const testId = existing[0].id
    
    console.log('\n--- Query with parameter (fails) ---')
    const r1 = await sql.unsafe('SELECT * FROM "workflow_folder" WHERE "id" = $1', [testId])
    console.log('Result count:', r1.length)
    console.log('Result[0]:', r1[0])
    
    console.log('\n--- Query with inline value (works) ---')
    const r2 = await sql.unsafe(`SELECT * FROM "workflow_folder" WHERE "id" = '${testId}'`)
    console.log('Result count:', r2.length)
    console.log('Result[0] name:', r2[0]?.name)
    
    console.log('\n--- Template literal with parameter (works?) ---')
    const r3 = await sql`SELECT * FROM "workflow_folder" WHERE "id" = ${testId}`
    console.log('Result count:', r3.length)
    console.log('Result[0] name:', r3[0]?.name)
  }
  
  await sql.end()
}

run().catch(console.error)
