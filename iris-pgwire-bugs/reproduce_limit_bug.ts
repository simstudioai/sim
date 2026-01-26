#!/usr/bin/env bun
/**
 * iris-pgwire Bug Reproduction: Parameterized LIMIT Returns Empty Columns
 *
 * Run with:
 *   bun run iris-pgwire-bugs/reproduce_limit_bug.ts
 *
 * Requires:
 *   - IRIS container running with iris-pgwire on port 5435
 *   - A table with at least one row (creates test data if needed)
 */

import postgres from 'postgres'

const CONNECTION_STRING = process.env.DATABASE_URL || 'postgresql://_SYSTEM:SYS@localhost:5435/USER'

async function reproduce() {
  console.log('='.repeat(70))
  console.log('iris-pgwire Bug Reproduction: Parameterized LIMIT')
  console.log('='.repeat(70))
  console.log(`\nConnection: ${CONNECTION_STRING}\n`)

  const sql = postgres(CONNECTION_STRING, {
    prepare: false,
    fetch_types: false, // Skip pg_type query for IRIS compatibility
  })

  try {
    // Ensure we have test data
    console.log('--- Setup: Ensuring test table and data exist ---')
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "limit_bug_test" (
        "id" VARCHAR(36) PRIMARY KEY,
        "name" VARCHAR(255),
        "value" INTEGER
      )
    `)

    const existing = await sql.unsafe('SELECT COUNT(*) as cnt FROM "limit_bug_test"')
    if (Number.parseInt(existing[0]?.cnt || '0') === 0) {
      // IRIS doesn't support multi-row INSERT, so insert one at a time
      await sql.unsafe(
        `INSERT INTO "limit_bug_test" ("id", "name", "value") VALUES ('id-001', 'First Row', 100)`
      )
      await sql.unsafe(
        `INSERT INTO "limit_bug_test" ("id", "name", "value") VALUES ('id-002', 'Second Row', 200)`
      )
      await sql.unsafe(
        `INSERT INTO "limit_bug_test" ("id", "name", "value") VALUES ('id-003', 'Third Row', 300)`
      )
      console.log('Created 3 test rows')
    } else {
      console.log(`Found ${existing[0].cnt} existing rows`)
    }

    // TEST 1: LIMIT as literal (WORKS)
    console.log('\n' + '='.repeat(70))
    console.log('TEST 1: LIMIT as literal value')
    console.log('Query: SELECT "id", "name" FROM "limit_bug_test" LIMIT 1')
    console.log('='.repeat(70))

    const r1 = await sql.unsafe('SELECT "id", "name" FROM "limit_bug_test" LIMIT 1')

    console.log('\nResult metadata:')
    console.log('  count:', (r1 as any).count)
    console.log('  columns:', (r1 as any).columns?.map((c: any) => c.name) || '(none)')
    console.log('\nResult data:')
    console.log('  row[0]:', r1[0])
    console.log('  Object.keys(row[0]):', Object.keys(r1[0] || {}))
    console.log('  Object.values(row[0]):', Object.values(r1[0] || {}))

    const test1Pass = r1[0]?.id && r1[0]?.name
    console.log('\nStatus:', test1Pass ? 'PASS' : 'FAIL')

    // TEST 2: LIMIT as parameter (FAILS)
    console.log('\n' + '='.repeat(70))
    console.log('TEST 2: LIMIT as parameter $1')
    console.log('Query: SELECT "id", "name" FROM "limit_bug_test" LIMIT $1')
    console.log('Params: [1]')
    console.log('='.repeat(70))

    const r2 = await sql.unsafe('SELECT "id", "name" FROM "limit_bug_test" LIMIT $1', [1])

    console.log('\nResult metadata:')
    console.log('  count:', (r2 as any).count)
    console.log('  columns:', (r2 as any).columns?.map((c: any) => c.name) || '(none)')
    console.log('\nResult data:')
    console.log('  row[0]:', r2[0])
    console.log('  Object.keys(row[0]):', Object.keys(r2[0] || {}))
    console.log('  Object.values(row[0]):', Object.values(r2[0] || {}))

    const test2Pass = r2[0]?.id && r2[0]?.name
    console.log('\nStatus:', test2Pass ? 'PASS' : 'FAIL')

    if (!test2Pass) {
      console.log('\n*** BUG CONFIRMED ***')
      console.log('Expected: { id: "id-001", name: "First Row" }')
      console.log('Actual:   {}')
      console.log('\nThe columns array is empty, so postgres.js cannot map values to field names.')
    }

    // TEST 3: Multiple parameters including LIMIT (FAILS)
    console.log('\n' + '='.repeat(70))
    console.log('TEST 3: WHERE parameter + LIMIT parameter')
    console.log('Query: SELECT "id", "name" FROM "limit_bug_test" WHERE "value" > $1 LIMIT $2')
    console.log('Params: [50, 2]')
    console.log('='.repeat(70))

    const r3 = await sql.unsafe(
      'SELECT "id", "name" FROM "limit_bug_test" WHERE "value" > $1 LIMIT $2',
      [50, 2]
    )

    console.log('\nResult metadata:')
    console.log('  count:', (r3 as any).count)
    console.log('  columns:', (r3 as any).columns?.map((c: any) => c.name) || '(none)')
    console.log('\nResult data:')
    console.log('  row[0]:', r3[0])

    const test3Pass = r3[0]?.id && r3[0]?.name
    console.log('\nStatus:', test3Pass ? 'PASS' : 'FAIL')

    // TEST 4: WHERE parameter only, no LIMIT param (WORKS - for comparison)
    console.log('\n' + '='.repeat(70))
    console.log('TEST 4: WHERE parameter only (no LIMIT param) - Control test')
    console.log('Query: SELECT "id", "name" FROM "limit_bug_test" WHERE "value" > $1')
    console.log('Params: [50]')
    console.log('='.repeat(70))

    const r4 = await sql.unsafe(
      'SELECT "id", "name" FROM "limit_bug_test" WHERE "value" > $1',
      [50]
    )

    console.log('\nResult metadata:')
    console.log('  count:', (r4 as any).count)
    console.log('  columns:', (r4 as any).columns?.map((c: any) => c.name) || '(none)')
    console.log('\nResult data:')
    console.log('  row[0]:', r4[0])

    const test4Pass = r4[0]?.id && r4[0]?.name
    console.log('\nStatus:', test4Pass ? 'PASS' : 'FAIL')

    // TEST 5: OFFSET as parameter (FAILS)
    console.log('\n' + '='.repeat(70))
    console.log('TEST 5: OFFSET as parameter')
    console.log('Query: SELECT "id", "name" FROM "limit_bug_test" LIMIT 1 OFFSET $1')
    console.log('Params: [1]')
    console.log('='.repeat(70))

    const r5 = await sql.unsafe('SELECT "id", "name" FROM "limit_bug_test" LIMIT 1 OFFSET $1', [1])

    console.log('\nResult metadata:')
    console.log('  count:', (r5 as any).count)
    console.log('  columns:', (r5 as any).columns?.map((c: any) => c.name) || '(none)')
    console.log('\nResult data:')
    console.log('  row[0]:', r5[0])

    const test5Pass = r5[0]?.id && r5[0]?.name
    console.log('\nStatus:', test5Pass ? 'PASS' : 'FAIL')

    // Summary
    console.log('\n' + '='.repeat(70))
    console.log('SUMMARY')
    console.log('='.repeat(70))
    console.log(`TEST 1 (LIMIT literal):      ${test1Pass ? 'PASS' : 'FAIL'}`)
    console.log(
      `TEST 2 (LIMIT $1):           ${test2Pass ? 'PASS' : 'FAIL'} ${!test2Pass ? '<-- BUG' : ''}`
    )
    console.log(
      `TEST 3 (WHERE $1 LIMIT $2):  ${test3Pass ? 'PASS' : 'FAIL'} ${!test3Pass ? '<-- BUG' : ''}`
    )
    console.log(`TEST 4 (WHERE $1 only):      ${test4Pass ? 'PASS' : 'FAIL'}`)
    console.log(
      `TEST 5 (OFFSET $1):          ${test5Pass ? 'PASS' : 'FAIL'} ${!test5Pass ? '<-- BUG' : ''}`
    )

    if (!test2Pass || !test3Pass || !test5Pass) {
      console.log('\nConclusion: Parameterized LIMIT/OFFSET causes empty column metadata.')
      console.log('This breaks Drizzle ORM and any client that relies on column names.')
    }
  } finally {
    await sql.end()
  }
}

reproduce().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
