import postgres from 'postgres'

async function run() {
  const sql = postgres('postgresql://_SYSTEM:SYS@localhost:5435/USER', {
    prepare: false,
  })

  console.log('--- Raw query WITHOUT transform ---')
  const res = await sql.unsafe('SELECT "id", "name" FROM "workflow_folder" LIMIT 1')
  
  console.log('\nRow type:', typeof res[0])
  console.log('Is array?:', Array.isArray(res[0]))
  console.log('Row prototype:', Object.getPrototypeOf(res[0]))
  console.log('\nObject.keys:', Object.keys(res[0]))
  console.log('Object.values:', Object.values(res[0]))
  console.log('\nDirect property access:')
  console.log('  res[0].id:', res[0].id)
  console.log('  res[0].name:', res[0].name)
  console.log('  res[0]["id"]:', res[0]["id"])
  console.log('\nNumeric index access:')
  console.log('  res[0][0]:', res[0][0])
  console.log('  res[0][1]:', res[0][1])
  
  console.log('\nResult metadata:')
  console.log('  columns:', (res as any).columns)
  console.log('  count:', (res as any).count)
  
  // Check if row has columns attached
  console.log('\nRow-level metadata:')
  console.log('  row.columns:', (res[0] as any).columns)
  
  await sql.end()
}

run().catch(console.error)
