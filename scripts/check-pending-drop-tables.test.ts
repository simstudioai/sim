import { auditFile } from '@scripts/check-pending-drop-tables'
import { describe, expect, it } from 'vitest'

const tables = new Map([
  ['userStats', new Set(['totalCost'])],
  ['organization', new Set(['departedMemberUsage'])],
])
const columns = new Map([
  ['userStatsColumns', 'userStats'],
  ['organizationColumns', 'organization'],
])

function audit(source: string) {
  return auditFile('insert-example.ts', source, tables, columns)
}

describe('pending-drop INSERT audit', () => {
  it.each([
    'db.insert(userStats).values({ id: "id", userId: "user" })',
    'db.insert(userStats).values({ id: "id" }).onConflictDoNothing().returning({ id: userStats.id })',
    'const target = userStats; tx.insert(target).values({ id: "id" })',
    'db.insert(alias(userStats, "stats")).values({ id: "id" })',
  ])('rejects implicit DEFAULT columns: %s', (statement) => {
    const findings = audit(`import { userStats } from '@sim/db/schema'; ${statement}`)
    expect(findings.some((finding) => finding.pattern.startsWith('insert()'))).toBe(true)
  })

  it.each([
    "import { userStats as stats } from '@sim/db/schema'; db.insert(stats).values({})",
    "import * as schema from '@sim/db/schema'; db.insert(schema.userStats).values({})",
  ])('resolves renamed and namespace table imports', (source) => {
    expect(audit(source)).toHaveLength(1)
  })

  it.each([
    `import { userStats, userStatsColumns } from '@sim/db/schema';
     import { withInsertColumns } from '@sim/db/insert-columns';
     db.insert(withInsertColumns(userStats, userStatsColumns)).values({}).returning()`,
    `import { userStats as stats, userStatsColumns as live } from '@sim/db/schema';
     import { withInsertColumns as project } from '@sim/db/insert-columns';
     db.insert(project(stats, live)).values({})`,
    `import * as schema from '@sim/db/schema';
     import { withInsertColumns } from '@sim/db/insert-columns';
     db.insert(withInsertColumns(schema.userStats, schema.userStatsColumns)).values({})`,
  ])('accepts the validated live-column map', (source) => {
    expect(audit(source)).toEqual([])
  })

  it.each(['{}', 'organizationColumns', '{ ...userStatsColumns, totalCost: userStats.totalCost }'])(
    'rejects an unverified or mismatched selection: %s',
    (selection) => {
      expect(
        audit(`
        import { userStats, userStatsColumns, organizationColumns } from '@sim/db/schema';
        import { withInsertColumns } from '@sim/db/insert-columns';
        db.insert(withInsertColumns(userStats, ${selection})).values({});
      `)
      ).toHaveLength(1)
    }
  )

  it('still rejects broad reads', () => {
    expect(
      audit(`import { userStats } from '@sim/db/schema'; db.select().from(userStats)`)
    ).toHaveLength(1)
  })

  it('validates namespace-imported insert helpers', () => {
    expect(
      audit(`
      import { userStats } from '@sim/db/schema';
      import * as inserts from '@sim/db/insert-columns';
      db.insert(inserts.withInsertColumns(userStats, {})).values({});
    `)
    ).toHaveLength(1)
  })
})
