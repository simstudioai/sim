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

  it.each([
    'function write(userStatsColumns) { INSERT }',
    'const write = ({ userStatsColumns }) => { INSERT }',
    'function write(userStatsColumns = arbitrary) { INSERT }',
    '{ const userStatsColumns = arbitrary; INSERT }',
    'function write() { INSERT; var userStatsColumns = arbitrary }',
    'try {} catch (userStatsColumns) { INSERT }',
    'for (const userStatsColumns of selections) { INSERT }',
    'const write = function userStatsColumns() { INSERT }',
  ])('rejects a shadowed live-column map: %s', (scope) => {
    const source = scope.replace(
      'INSERT',
      'db.insert(withInsertColumns(userStats, userStatsColumns)).values({});'
    )
    expect(
      audit(`
        import { userStats, userStatsColumns } from '@sim/db/schema';
        import { withInsertColumns } from '@sim/db/insert-columns';
        ${source}
      `)
    ).toEqual([
      expect.objectContaining({ pattern: expect.stringContaining('validated live-column map') }),
    ])
  })

  it.each([
    `import { userStats, userStatsColumns as live } from '@sim/db/schema';
     function write(live) { db.insert(withInsertColumns(userStats, live)).values({}) }`,
    `import { userStats } from '@sim/db/schema';
     import * as schema from '@sim/db/schema';
     function write(schema) {
       db.insert(withInsertColumns(userStats, schema.userStatsColumns)).values({})
     }`,
  ])('rejects shadowed renamed and namespace selections', (source) => {
    expect(audit(`import { withInsertColumns } from '@sim/db/insert-columns'; ${source}`)).toEqual([
      expect.objectContaining({ pattern: expect.stringContaining('validated live-column map') }),
    ])
  })

  it.each([
    `import { withInsertColumns } from '@sim/db/insert-columns';
     function write(withInsertColumns) {
       db.insert(withInsertColumns(userStats, userStatsColumns)).values({})
     }`,
    `import * as inserts from '@sim/db/insert-columns';
     function write(inserts) {
       db.insert(inserts.withInsertColumns(userStats, userStatsColumns)).values({})
     }`,
  ])('rejects a shadowed INSERT helper', (source) => {
    expect(
      audit(`import { userStats, userStatsColumns } from '@sim/db/schema'; ${source}`)
    ).toEqual([
      expect.objectContaining({ pattern: expect.stringContaining('imported INSERT helper') }),
    ])
  })

  it('keeps imports valid outside the shadowing scope', () => {
    expect(
      audit(`
        import { userStats, userStatsColumns } from '@sim/db/schema';
        import { withInsertColumns } from '@sim/db/insert-columns';
        function unrelated(userStatsColumns, withInsertColumns) {}
        { const userStatsColumns = arbitrary }
        function write() {
          db.insert(withInsertColumns(userStats, userStatsColumns)).values({})
        }
      `)
    ).toEqual([])
  })

  it('accepts namespace-imported INSERT helpers', () => {
    expect(
      audit(`
        import * as schema from '@sim/db/schema';
        import * as inserts from '@sim/db/insert-columns';
        db.insert(inserts.withInsertColumns(schema.userStats, schema.userStatsColumns)).values({});
      `)
    ).toEqual([])
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
