/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RowExecutionMetadata } from '@/lib/table/types'

vi.mock('@sim/db', () => dbChainMock)

import { writeExecutionsPatch } from '@/lib/table/rows/executions'

const EXECUTION_STATE: RowExecutionMetadata = {
  status: 'running',
  executionId: 'execution-1',
  jobId: null,
  workflowId: 'workflow-1',
  error: null,
}

function renderCondition(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  const strings = Array.isArray(record.strings)
    ? record.strings.filter((entry): entry is string => typeof entry === 'string').join('')
    : ''
  const conditions = Array.isArray(record.conditions)
    ? record.conditions.map(renderCondition).join(' ')
    : ''
  return `${strings} ${conditions}`.trim()
}

describe('writeExecutionsPatch guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('rejects a worker write when the atomic stale-or-cancel predicate returns no row', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(
      writeExecutionsPatch(
        dbChainMock.db as unknown as Parameters<typeof writeExecutionsPatch>[0],
        'table-1',
        'row-1',
        { 'group-1': EXECUTION_STATE },
        { groupId: 'group-1', executionId: 'execution-1' }
      )
    ).resolves.toBe('guard-rejected')

    const conflict = dbChainMockFns.onConflictDoUpdate.mock.calls[0]?.[0] as
      | { where?: unknown }
      | undefined
    const condition = renderCondition(conflict?.where)
    expect(condition).toContain("<> 'cancelled'")
    expect(condition).toContain('IS NULL OR')
  })

  it('keeps queued takeover and late-same-run protection in the SQL predicate', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(
      writeExecutionsPatch(
        dbChainMock.db as unknown as Parameters<typeof writeExecutionsPatch>[0],
        'table-1',
        'row-1',
        { 'group-1': { ...EXECUTION_STATE, status: 'queued' } },
        {
          groupId: 'group-1',
          executionId: 'execution-1',
          allowNewExecution: true,
        }
      )
    ).resolves.toBe('guard-rejected')

    const conflict = dbChainMockFns.onConflictDoUpdate.mock.calls[0]?.[0] as
      | { where?: unknown }
      | undefined
    const condition = renderCondition(conflict?.where)
    expect(condition).toContain('IS DISTINCT FROM')
    expect(condition).toContain("= 'pending'")
  })
})
