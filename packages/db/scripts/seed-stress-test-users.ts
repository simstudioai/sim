/**
 * Seed script to populate the stress_test_users table.
 *
 * Usage:
 *   cd packages/db && bun run scripts/seed-stress-test-users.ts
 */

import { eq, type InferInsertModel } from 'drizzle-orm'
import { db, userTableDefinitions, userTableRows } from '../index'

const WORKSPACE_ID = '098d71e1-6a36-47e3-874d-818faee0bfe8'
const TABLE_NAME = 'stress_test_users'
const NUM_ROWS = 100000

interface UserRow {
  name: string
  email: string
  age: number
  department: string
  salary: number
  active: boolean
  hire_date: string
  country: string
}

const departments = [
  'Engineering',
  'Sales',
  'Marketing',
  'HR',
  'Finance',
  'Operations',
  'Legal',
  'Product',
]
const countries = [
  'USA',
  'UK',
  'Germany',
  'France',
  'Canada',
  'Australia',
  'Japan',
  'India',
  'Brazil',
  'Singapore',
]
const firstNames = [
  'James',
  'Mary',
  'John',
  'Patricia',
  'Robert',
  'Jennifer',
  'Michael',
  'Linda',
  'William',
  'Elizabeth',
  'David',
  'Barbara',
  'Richard',
  'Susan',
  'Joseph',
  'Jessica',
  'Thomas',
  'Sarah',
  'Charles',
  'Karen',
]
const lastNames = [
  'Smith',
  'Johnson',
  'Williams',
  'Brown',
  'Jones',
  'Garcia',
  'Miller',
  'Davis',
  'Rodriguez',
  'Martinez',
  'Hernandez',
  'Lopez',
  'Gonzalez',
  'Wilson',
  'Anderson',
  'Thomas',
  'Taylor',
  'Moore',
  'Jackson',
  'Martin',
]

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomDate(start: Date, end: Date): string {
  const date = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()))
  return date.toISOString().split('T')[0]
}

function generateUserRow(index: number): UserRow {
  const firstName = randomItem(firstNames)
  const lastName = randomItem(lastNames)
  const domain = randomItem(['gmail.com', 'yahoo.com', 'outlook.com', 'company.com', 'work.org'])

  return {
    name: `${firstName} ${lastName}`,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${index}@${domain}`,
    age: randomInt(22, 65),
    department: randomItem(departments),
    salary: randomInt(40000, 200000),
    active: Math.random() > 0.1, // 90% active
    hire_date: randomDate(new Date('2015-01-01'), new Date('2024-12-31')),
    country: randomItem(countries),
  }
}

async function main() {
  console.log(`Seeding ${TABLE_NAME} table for workspace ${WORKSPACE_ID}...`)

  // Get user ID for created_by
  const userResult = (await db.execute(`SELECT id FROM "user" LIMIT 1`)) as { id: string }[]
  const userId = Array.isArray(userResult) && userResult[0] ? userResult[0].id : 'system'
  console.log(`Using user ID: ${userId}`)

  // Check if table already exists
  const existingTable = await db
    .select()
    .from(userTableDefinitions)
    .where(eq(userTableDefinitions.workspaceId, WORKSPACE_ID))
    .limit(1)

  let tableId: string

  if (existingTable.length > 0 && existingTable[0].name === TABLE_NAME) {
    tableId = existingTable[0].id
    console.log(`Table ${TABLE_NAME} already exists (${tableId}), clearing existing rows...`)

    // Delete existing rows
    await db.delete(userTableRows).where(eq(userTableRows.tableId, tableId))

    // Reset row count (trigger will update it as we insert)
    await db
      .update(userTableDefinitions)
      .set({ rowCount: 0, updatedAt: new Date() })
      .where(eq(userTableDefinitions.id, tableId))
  } else {
    // Create table
    tableId = `tbl_${crypto.randomUUID().replace(/-/g, '')}`
    const now = new Date()

    const tableSchema = {
      columns: [
        { name: 'name', type: 'string', required: true },
        { name: 'email', type: 'string', required: true, unique: true },
        { name: 'age', type: 'number', required: true },
        { name: 'department', type: 'string', required: true },
        { name: 'salary', type: 'number', required: true },
        { name: 'active', type: 'boolean', required: true },
        { name: 'hire_date', type: 'string', required: true },
        { name: 'country', type: 'string', required: true },
      ],
    }

    await db.insert(userTableDefinitions).values({
      id: tableId,
      workspaceId: WORKSPACE_ID,
      name: TABLE_NAME,
      description: 'Stress test table with sample user data',
      schema: tableSchema,
      maxRows: 10000,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })

    console.log(`Created table ${TABLE_NAME} (${tableId})`)
  }

  // Generate and insert rows in batches
  const batchSize = 1000
  const now = new Date()

  console.log(`Inserting ${NUM_ROWS} rows in batches of ${batchSize}...`)

  for (let i = 0; i < NUM_ROWS; i += batchSize) {
    const batch: InferInsertModel<typeof userTableRows>[] = []
    const endIdx = Math.min(i + batchSize, NUM_ROWS)

    for (let j = i; j < endIdx; j++) {
      batch.push({
        id: `row_${crypto.randomUUID().replace(/-/g, '')}`,
        tableId,
        workspaceId: WORKSPACE_ID,
        data: generateUserRow(j),
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      })
    }

    await db.insert(userTableRows).values(batch)
    console.log(`  Inserted rows ${i + 1} to ${endIdx}`)
  }

  // Verify final row count
  const finalTable = await db
    .select({ rowCount: userTableDefinitions.rowCount })
    .from(userTableDefinitions)
    .where(eq(userTableDefinitions.id, tableId))
    .limit(1)

  console.log(`\nDone! Table ${TABLE_NAME} now has ${finalTable[0]?.rowCount ?? 0} rows.`)

  process.exit(0)
}

main().catch((err) => {
  console.error('Error seeding data:', err)
  process.exit(1)
})
