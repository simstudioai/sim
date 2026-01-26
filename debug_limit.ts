import postgres from 'postgres'

async function run() {
  const sql = postgres('postgresql://_SYSTEM:SYS@localhost:5435/USER', {
    prepare: false,
  })
  
  console.log('--- LIMIT as literal ---')
  const r1 = await sql.unsafe('SELECT "id", "name" FROM "workflow_folder" LIMIT 1')
  console.log('Result[0]:', r1[0])
  
  console.log('\n--- LIMIT as $1 parameter ---')
  const r2 = await sql.unsafe('SELECT "id", "name" FROM "workflow_folder" LIMIT $1', [1])
  console.log('Result[0]:', r2[0])
  console.log('Result[0] keys:', Object.keys(r2[0] || {}))
  
  console.log('\n--- LIMIT as template literal ---')
  const limit = 1
  const r3 = await sql`SELECT "id", "name" FROM "workflow_folder" LIMIT ${limit}`
  console.log('Result[0]:', r3[0])
  
  console.log('\n--- Column select with LIMIT $1 ---')
  const r4 = await sql.unsafe('SELECT "id" FROM "workflow_folder" LIMIT $1', [1])
  console.log('Result:', r4)
  console.log('Result[0]:', r4[0])
  
  await sql.end()
}

run().catch(console.error)
