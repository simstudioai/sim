import { describe, expect, test } from 'bun:test'
import { findSqlDateBindingViolations } from './check-sql-date-binding'

describe('sql Date binding audit', () => {
  test('rejects every unbound Date form that reaches a raw template', () => {
    const violations = findSqlDateBindingViolations(`
      const now = new Date()
      const threshold = new Date(now.getTime() - 1000)
      const alias = threshold
      function scan(cutoff: Date, since: Date | null) {
        const inline = sql\`col < \${new Date(cursor.ts)}\`
        const local = sql\`col < \${now}\`
        const chained = sql\`col < \${alias}\`
        const generic = sql<boolean>\`col < \${threshold}\`
        const annotated = sql\`col < \${cutoff}\`
        const nullable = sql\`col < \${since}\`
        const fallback = sql\`col < \${since ?? now}\`
        const unencoded = sql.param(now)
      }
    `)

    expect(violations.map((violation) => violation.expression)).toEqual([
      'new Date(cursor.ts)',
      'now',
      'alias',
      'threshold',
      'cutoff',
      'since',
      'since ?? now',
      'now',
    ])
  })

  test('accepts column-bound params, non-Date values, and annotated exceptions', () => {
    expect(
      findSqlDateBindingViolations(`
        const now = new Date()
        const bound = sql\`col < \${sql.param(now, asyncJobs.startedAt)}\`
        const fragment = sql\`col < \${sql.param(new Date(), table.createdAt)}\`
        const columns = sql\`\${table.startedAt} < \${table.endedAt}\`
        const scalars = sql\`col < \${MAX_INT32} AND name = \${name}\`
        const notSql = other\`col < \${now}\`
        // sql-date-bound: raw text column, no timestamp encoding applies
        const excused = sql\`col < \${now}\`
      `)
    ).toEqual([])
  })
})
