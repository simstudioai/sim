import postgres from 'postgres'

async function run() {
  const sql = postgres('postgresql://_SYSTEM:SYS@localhost:5435/USER', {
    prepare: false,
  })
  
  console.log('--- Parameterized INSERT then SELECT ---')
  const uuid = crypto.randomUUID()
  
  // Insert with parameters
  console.log('Inserting with id:', uuid)
  await sql.unsafe(`
    INSERT INTO "workflow_folder" 
    ("id", "name", "user_id", "workspace_id", "color", "sort_order") 
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [uuid, 'Debug Test', '00000000-0000-0000-0000-000000000000', 'ws-debug', '#FF0000', 999])
  
  // Select with parameter - THIS IS WHAT FAILS
  console.log('\nSelect with parameter:')
  const r1 = await sql.unsafe('SELECT "id", "name" FROM "workflow_folder" WHERE "id" = $1', [uuid])
  console.log('Result rows:', r1.length)
  console.log('Result[0]:', r1[0])
  console.log('Result[0] keys:', Object.keys(r1[0] || {}))
  
  // Select without parameter - workaround
  console.log('\nSelect with inline id:')
  const r2 = await sql.unsafe(`SELECT "id", "name" FROM "workflow_folder" WHERE "id" = '${uuid}'`)
  console.log('Result rows:', r2.length)
  console.log('Result[0]:', r2[0])
  
  // Cleanup
  await sql.unsafe(`DELETE FROM "workflow_folder" WHERE "id" = '${uuid}'`)
  
  await sql.end()
}

run().catch(console.error)
