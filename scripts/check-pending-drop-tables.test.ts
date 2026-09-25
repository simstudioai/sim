import { auditFile } from '@scripts/check-pending-drop-tables'
import { describe, expect, it } from 'vitest'

const tables = new Map([['retiringTable', new Set(['retired', 'otherRetired'])]])

function audit(statement: string) {
  return auditFile(
    'query-example.ts',
    `import { retiringTable } from '@sim/db/schema'; ${statement}`,
    tables
  )
}

describe('pending-drop query audit', () => {
  it.each([
    'db.insert(retiringTable).values({ id: "id" })',
    'db.insert(retiringTable).values({ id: "id" }).onConflictDoNothing().returning({ id: retiringTable.id })',
    'const target = retiringTable; tx.insert(target).values({ id: "id" })',
    'db.insert(alias(retiringTable, "stats")).values({ id: "id" })',
  ])('rejects implicit DEFAULT columns: %s', (statement) => {
    expect(audit(statement)).toEqual([
      expect.objectContaining({ pattern: expect.stringContaining('insert()') }),
    ])
  })

  it.each([
    'db.select().from(retiringTable)',
    'db.selectDistinct().from(retiringTable)',
    'db.selectDistinctOn([retiringTable.id]).from(retiringTable)',
    'db.query.retiringTable.findFirst()',
    'db.query.retiringTable.findMany({ where: predicate })',
    'db.update(retiringTable).set({ id: "id" }).returning()',
    'db.delete(retiringTable).returning()',
    'getTableColumns(retiringTable)',
  ])('rejects implicit full-table selections: %s', (statement) => {
    expect(audit(statement)).toHaveLength(1)
  })

  it.each([
    'db.select({ id: retiringTable.id }).from(retiringTable)',
    'db.query.retiringTable.findFirst({ columns: { id: true } })',
    'db.update(retiringTable).set({ id: "id" }).returning({ id: retiringTable.id })',
    'omit(getTableColumns(retiringTable), ["retired", "otherRetired"])',
    'const { retired, otherRetired, ...live } = getTableColumns(retiringTable)',
    'db.insert(activeTable).values({ id: "id" }).returning()',
  ])('allows explicit selections and tables without pending drops: %s', (statement) => {
    expect(audit(statement)).toEqual([])
  })

  it.each([
    'omit(getTableColumns(retiringTable), ["retired"])',
    'const { retired, ...live } = getTableColumns(retiringTable)',
  ])('rejects an incomplete live-column selection: %s', (statement) => {
    expect(audit(statement)).toEqual([
      expect.objectContaining({ pattern: expect.stringContaining('otherRetired') }),
    ])
  })
})
