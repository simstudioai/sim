/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'

vi.unmock('drizzle-orm')
vi.unmock('@sim/db')
vi.unmock('@sim/db/schema')

process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test'

const { PgDialect } = await import('drizzle-orm/pg-core')
const { workflowExecutionOriginSql } = await import('@/lib/logs/execution-origin')

describe('workflowExecutionOriginSql', () => {
  const query = new PgDialect().sqlToQuery(workflowExecutionOriginSql())

  it('uses only durable workflow-group correlation', () => {
    expect(query.sql).toContain('"workflow_execution_logs"."execution_data"')
    expect(query.sql).toContain("->'correlation'->>'source'")
    expect(query.sql).not.toContain("->'trigger'")
    expect(query.sql).not.toContain('"table_row_executions"')
    expect(query.sql).toMatch(/->>'source'\s*=\s*'workflow_group'/)
  })

  it('does not infer workflow-group origin from the generic table trigger name', () => {
    expect(query.sql).not.toContain('"workflow_execution_logs"."trigger" = \'table\'')
    expect(query.sql).not.toContain("IS DISTINCT FROM 'webhook'")
  })
})
