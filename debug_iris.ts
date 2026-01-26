import postgres from 'postgres'

async function run() {
  const sql = postgres('postgresql://_SYSTEM:SYS@localhost:5435/USER', {
    prepare: false,
    transform: {
      column: (col) => {
        console.log('Column from server:', col)
        return col.toLowerCase()
      },
    },
  })

  console.log('--- Querying permissions with quoted name, NO alias ---')
  const res1c = await sql.unsafe('SELECT "permission_kind" FROM "permissions" LIMIT 1')
  console.log('Result 1c Row Keys:', Object.keys(res1c[0]))
  console.log('Result 1c Row [0]:', res1c[0][0])

  console.log('--- Querying workflow_folder ---')
  const res2 = await sql.unsafe('SELECT "id", "name" FROM "workflow_folder" LIMIT 1')
  console.log('Result 2:', res2)
  if (res2[0]) {
    console.log('Result 2 Row Keys:', Object.keys(res2[0]))
    console.log('Result 2 Row [0]:', res2[0][0])
  }

  await sql.end()
}

run().catch(console.error)
