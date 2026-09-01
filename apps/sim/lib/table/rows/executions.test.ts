/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'
import { loadExecutionsByRow, writeExecutionsPatch } from '@/lib/table/rows/executions'
import type { RowExecutionMetadata } from '@/lib/table/types'

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

  /**
   * The dispatcher's `pending` marker is drained by whichever worker owns the
   * row's cascade lock, which may belong to another dispatch entirely. Storing
   * the requesting subject with the marker is what lets that drain run under
   * the person who asked rather than under the owner's own subject.
   */
  it('persists the pre-stamp’s governed subject on both the insert and the upsert', async () => {
    await writeExecutionsPatch(
      dbChainMock.db as unknown as Parameters<typeof writeExecutionsPatch>[0],
      'table-1',
      'row-1',
      {
        'group-1': {
          ...EXECUTION_STATE,
          status: 'pending',
          executionId: null,
          capabilityGovernedUserId: 'requesting-member',
        },
      }
    )

    const values = dbChainMockFns.values.mock.calls[0]?.[0] as Record<string, unknown>
    expect(values.capabilityGovernedUserId).toBe('requesting-member')
    const conflict = dbChainMockFns.onConflictDoUpdate.mock.calls[0]?.[0] as {
      set: Record<string, unknown>
    }
    expect(conflict.set.capabilityGovernedUserId).toBe('requesting-member')
  })

  /** A write that names no subject clears it — only an unclaimed marker is read. */
  it('writes null for a state that carries no subject', async () => {
    await writeExecutionsPatch(
      dbChainMock.db as unknown as Parameters<typeof writeExecutionsPatch>[0],
      'table-1',
      'row-1',
      { 'group-1': EXECUTION_STATE }
    )

    const values = dbChainMockFns.values.mock.calls[0]?.[0] as Record<string, unknown>
    expect(values.capabilityGovernedUserId).toBeNull()
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

  it('guards usage-limit deletion against cancelled and newer execution rows', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(
      writeExecutionsPatch(
        dbChainMock.db as unknown as Parameters<typeof writeExecutionsPatch>[0],
        'table-1',
        'row-1',
        { 'group-1': null },
        { groupId: 'group-1', executionId: 'execution-1' }
      )
    ).resolves.toBe('guard-rejected')

    const condition = renderCondition(dbChainMockFns.where.mock.calls.at(-1)?.[0])
    expect(condition).toContain("<> 'cancelled'")
    expect(condition).toContain('IS NULL OR')
  })

  it('deletes the usage-limit pre-stamp only when its execution guard wins', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ rowId: 'row-1' }])

    await expect(
      writeExecutionsPatch(
        dbChainMock.db as unknown as Parameters<typeof writeExecutionsPatch>[0],
        'table-1',
        'row-1',
        { 'group-1': null },
        { groupId: 'group-1', executionId: 'execution-1' }
      )
    ).resolves.toBe('wrote')
  })
})

interface StoredExecution {
  rowId: string
  groupId: string
  status: string
  executionId: string | null
  jobId: string | null
  workflowId: string
  error: string | null
  runningBlockIds: string[]
  blockErrors: unknown
  cancelledAt: Date | null
}

function storedExecution(overrides: Partial<StoredExecution> & { rowId: string }): StoredExecution {
  return {
    groupId: 'group-1',
    status: 'completed',
    executionId: 'execution-1',
    jobId: null,
    workflowId: 'workflow-1',
    error: null,
    runningBlockIds: [],
    blockErrors: {},
    cancelledAt: null,
    ...overrides,
  }
}

/**
 * Stands in for the drizzle builder `loadExecutionsByRow` drives, handing back
 * one queued page per `select()` so a test can assert how many round trips the
 * drain made before it stopped.
 */
function fakeTrx(pages: StoredExecution[][]) {
  const where = vi.fn()
  for (const page of pages) where.mockResolvedValueOnce(page)
  where.mockResolvedValue([])
  const select = vi.fn(() => ({ from: () => ({ where }) }))
  return { trx: { select } as unknown as DbOrTx, select }
}

describe('loadExecutionsByRow', () => {
  it('drops block-error members that are not strings', async () => {
    const { trx } = fakeTrx([
      [
        storedExecution({
          rowId: 'row-1',
          blockErrors: { 'block-1': 'boom', 'block-2': 42, 'block-3': null },
        }),
      ],
    ])

    const byRow = await loadExecutionsByRow(trx, ['row-1'])

    expect(byRow.get('row-1')?.['group-1'].blockErrors).toEqual({ 'block-1': 'boom' })
  })

  /**
   * `blockErrors` is schemaless jsonb, so a blob that is not an object at all is
   * reachable on read. Omitting the key is what lets the published contract keep
   * declaring `Record<string, string>` without a drifted row becoming a 500.
   */
  it('omits block errors entirely when the stored blob is not an object map', async () => {
    const { trx } = fakeTrx([[storedExecution({ rowId: 'row-1', blockErrors: ['boom'] })]])

    const byRow = await loadExecutionsByRow(trx, ['row-1'])

    expect(byRow.get('row-1')?.['group-1']).not.toHaveProperty('blockErrors')
  })

  /**
   * The budget is spent DURING the drain: the refusal has to land before the
   * remaining chunks are read, or the heap spike the ceiling exists to prevent
   * has already happened by the time anything measures it.
   */
  it('refuses past the byte budget without reading the remaining chunks', async () => {
    const fat = 'x'.repeat(4096)
    const page = (prefix: string) =>
      Array.from({ length: 250 }, (_, index) =>
        storedExecution({ rowId: `${prefix}-${index}`, error: fat })
      )
    const { trx, select } = fakeTrx([page('a'), page('b'), page('c')])
    const ids = Array.from({ length: 750 }, (_, index) => `row-${index}`)

    await expect(loadExecutionsByRow(trx, ids, { budgetBytes: 512 * 1024 })).rejects.toMatchObject({
      code: 'payload_too_large',
      name: 'TableRunStateCollectionLimitExceededError',
    })

    expect(select.mock.calls.length).toBeLessThan(3)
  })

  it('reads every chunk when the sidecar fits the budget', async () => {
    const page = (prefix: string) =>
      Array.from({ length: 250 }, (_, index) => storedExecution({ rowId: `${prefix}-${index}` }))
    const { trx, select } = fakeTrx([page('a'), page('b'), page('c')])
    const ids = Array.from({ length: 750 }, (_, index) => `row-${index}`)

    const byRow = await loadExecutionsByRow(trx, ids, { budgetBytes: 2 * 1024 * 1024 })

    expect(select).toHaveBeenCalledTimes(3)
    expect(byRow.size).toBe(750)
  })
})
