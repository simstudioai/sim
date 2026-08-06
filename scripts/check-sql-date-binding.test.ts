import { describe, expect, test } from 'bun:test'
import { analyzeSource, findSqlDateBindingViolations, SCAN_DIRS } from './check-sql-date-binding'

const DRIZZLE_IMPORT = "import { sql } from 'drizzle-orm'"

describe('sql Date binding audit', () => {
  test('rejects every unbound Date form that reaches a raw template', () => {
    const violations = findSqlDateBindingViolations(`
      ${DRIZZLE_IMPORT}
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
        ${DRIZZLE_IMPORT}
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

  test('rejects annotation markers that are malformed or incidental', () => {
    const violations = findSqlDateBindingViolations(`
      ${DRIZZLE_IMPORT}
      const now = new Date()
      // sql-date-bound:
      const bareMarker = sql\`col < \${now}\`
      const label = 'sql-date-bound: not a comment'
      const incidental = sql\`col < \${now}\`
      // trailing marker sql-date-bound: reason
      const misplaced = sql\`col < \${now}\`
    `)

    expect(violations.map((violation) => violation.expression)).toEqual(['now', 'now', 'now'])
  })

  describe('tag resolution', () => {
    test('ignores a postgres-js client tag that happens to be named sql', () => {
      expect(
        findSqlDateBindingViolations(`
          import postgres from 'postgres'
          const sql = postgres(process.env.DATABASE_URL)
          const now = new Date()
          const rows = await sql\`select * from runs where started_at < \${now}\`
        `)
      ).toEqual([])
    })

    test('flags an aliased drizzle import', () => {
      expect(
        findSqlDateBindingViolations(`
          import { sql as raw } from 'drizzle-orm'
          const now = new Date()
          const fragment = raw\`col < \${now}\`
        `).map((violation) => violation.expression)
      ).toEqual(['now'])
    })

    test('flags a namespace-imported drizzle tag and its param helper', () => {
      expect(
        findSqlDateBindingViolations(`
          import * as d from 'drizzle-orm'
          const now = new Date()
          const fragment = d.sql\`col < \${now}\`
          const unencoded = d.sql.param(now)
        `).map((violation) => violation.expression)
      ).toEqual(['now', 'now'])
    })
  })

  describe('scoping', () => {
    test('does not let an interface field poison identifiers elsewhere in the file', () => {
      expect(
        findSqlDateBindingViolations(`
          ${DRIZZLE_IMPORT}
          interface Row {
            start: Date
          }
          function query(start: number) {
            return sql\`limit \${start}\`
          }
        `)
      ).toEqual([])
    })

    test('does not let a Date in one function bind a same-named value in another', () => {
      expect(
        findSqlDateBindingViolations(`
          ${DRIZZLE_IMPORT}
          function stamp() {
            const now = new Date()
            return now.toISOString()
          }
          function paginate() {
            const now = Date.now()
            return sql\`created_at_ms < \${now}\`
          }
        `)
      ).toEqual([])
    })

    test('still flags a module-scope Date used inside a function', () => {
      expect(
        findSqlDateBindingViolations(`
          ${DRIZZLE_IMPORT}
          const now = new Date()
          function paginate() {
            return sql\`created_at < \${now}\`
          }
        `).map((violation) => violation.expression)
      ).toEqual(['now'])
    })

    test('still flags a destructured Date parameter typed inline', () => {
      expect(
        findSqlDateBindingViolations(`
          ${DRIZZLE_IMPORT}
          function query({ since }: { since: Date }) {
            return sql\`col < \${since}\`
          }
        `).map((violation) => violation.expression)
      ).toEqual(['since'])
    })

    test('still flags a destructured Date parameter typed by a named interface', () => {
      expect(
        findSqlDateBindingViolations(`
          ${DRIZZLE_IMPORT}
          interface Range {
            since: Date
          }
          function query({ since }: Range) {
            return sql\`col < \${since}\`
          }
        `).map((violation) => violation.expression)
      ).toEqual(['since'])
    })
  })

  describe('allow annotation placement', () => {
    test('accepts the annotation above a multi-line template', () => {
      expect(
        findSqlDateBindingViolations(`
          ${DRIZZLE_IMPORT}
          const now = new Date()
          // sql-date-bound: text column, compared as an ISO string
          const fragment = sql\`
            CASE
              WHEN started_at < \${now} THEN 1
              ELSE 0
            END
          \`
        `)
      ).toEqual([])
    })

    test('still rejects a bare marker above a multi-line template', () => {
      expect(
        findSqlDateBindingViolations(`
          ${DRIZZLE_IMPORT}
          const now = new Date()
          // sql-date-bound:
          const fragment = sql\`
            CASE
              WHEN started_at < \${now} THEN 1
            END
          \`
        `).map((violation) => violation.expression)
      ).toEqual(['now'])
    })
  })

  test('scans the root scripts directory', () => {
    expect(SCAN_DIRS.some((dir) => dir.endsWith('/scripts'))).toBe(true)
  })

  describe('parser robustness', () => {
    test('parses decorators instead of throwing', () => {
      const analysis = analyzeSource(`
        ${DRIZZLE_IMPORT}
        @Injectable()
        class Repo {
          find(since: Date) {
            return sql\`col < \${since}\`
          }
        }
      `)

      expect(analysis.parseError).toBeUndefined()
      expect(analysis.violations.map((violation) => violation.expression)).toEqual(['since'])
    })

    test('reports an unparseable file as skipped instead of throwing', () => {
      const analysis = analyzeSource('const a = (', 'broken.ts')

      expect(analysis.parseError).toBeTruthy()
      expect(analysis.violations).toEqual([])
    })
  })
})
