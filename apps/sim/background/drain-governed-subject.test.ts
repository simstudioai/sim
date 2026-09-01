/**
 * @vitest-environment node
 */
import { resetDbChainMock } from '@sim/testing'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getTableById: vi.fn(),
  getRowById: vi.fn(),
  pickNextEligibleGroupForRow: vi.fn(),
  writeWorkflowGroupState: vi.fn(),
  markWorkflowGroupPickedUp: vi.fn(),
  runEnrichment: vi.fn(),
  getEnrichment: vi.fn(),
  readStampedCapabilitySubject: vi.fn(),
  checkAttributedUsageLimits: vi.fn(),
  loadTableRowSecretProvenance: vi.fn(),
}))

vi.mock('@/lib/table/service', () => ({ getTableById: mocks.getTableById }))
vi.mock('@/lib/table/rows/service', () => ({ getRowById: mocks.getRowById, updateRow: vi.fn() }))
vi.mock('@/lib/table/rows/executions', () => ({
  readStampedCapabilitySubject: mocks.readStampedCapabilitySubject,
}))
vi.mock('@/lib/table/workflow-columns', () => ({
  pickNextEligibleGroupForRow: mocks.pickNextEligibleGroupForRow,
  stashCellContextForResume: vi.fn(),
  buildWorkflowGroupExecutionCorrelation: vi.fn(),
}))
vi.mock('@/lib/table/cell-write', () => ({
  buildCancelledExecution: vi.fn(),
  createWorkflowCellProgressWriter: vi.fn(),
  writeWorkflowGroupState: mocks.writeWorkflowGroupState,
  markWorkflowGroupPickedUp: mocks.markWorkflowGroupPickedUp,
}))
vi.mock('@/lib/table/workflow-cell-result', () => ({
  classifyWorkflowCellTerminalResult: vi.fn(),
}))
vi.mock('@/enrichments/registry', () => ({ getEnrichment: mocks.getEnrichment }))
vi.mock('@/enrichments/run', () => ({
  runEnrichment: mocks.runEnrichment,
  skippedEnrichmentDetail: () => ({}),
}))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionSnapshot: (snapshot: unknown) => snapshot,
  checkAttributedUsageLimits: mocks.checkAttributedUsageLimits,
  toBillingContext: () => ({}),
}))
vi.mock('@/lib/table/rows/secret-provenance', () => ({
  createExactEmptyTableRowSecretProvenance: () => ({ complete: true, columns: {} }),
  createTableRowSecretProvenanceFromRegistry: () => ({ complete: true, columns: {} }),
  loadTableRowSecretProvenance: mocks.loadTableRowSecretProvenance,
}))
vi.mock('@/lib/table/events', () => ({ appendTableEvent: vi.fn() }))

/**
 * Unmocked, the pacing loop constructs a real RateLimiter against the global
 * db mock and sleeps real jittered backoff between attempts — nondeterministic
 * seconds per test, and a timeout under a loaded parallel run.
 */
vi.mock('@/lib/core/rate-limiter/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitWithSubscription = vi.fn().mockResolvedValue({ allowed: true })
  },
}))
vi.mock('@/lib/table/dispatcher', () => ({
  readDispatch: vi.fn(async () => ({ id: 'tdsp_carrier', status: 'dispatching' })),
  completeDispatchIfActive: vi.fn(),
}))

import { runRowCascadeLoop } from '@/background/workflow-column-execution'

function enrichmentGroup(id: string) {
  return {
    id,
    type: 'enrichment',
    enrichmentId: 'enrich-1',
    workflowId: '',
    outputs: [{ blockId: '', path: 'out', columnName: 'out' }],
    inputMappings: [{ inputName: 'domain', columnName: 'domain' }],
  }
}

const TABLE = {
  id: 'table-1',
  name: 'Table',
  workspaceId: 'workspace-1',
  schema: {
    columns: [{ id: 'domain', name: 'domain', type: 'string' }],
    workflowGroups: [enrichmentGroup('group-1'), enrichmentGroup('group-2')],
  },
}

/** The carrier belongs to an actorless auto-fire: no subject, so no tool gate. */
const CARRIER = {
  tableId: 'table-1',
  tableName: 'Table',
  rowId: 'row-1',
  groupId: 'group-1',
  workflowId: '',
  enrichmentId: 'enrich-1',
  workspaceId: 'workspace-1',
  executionId: 'execution-1',
  dispatchId: 'tdsp_carrier',
  executionTimeoutMs: 10_000,
  capabilityGovernedUserId: null,
  billingAttribution: {
    actorUserId: 'user-1',
    workspaceId: 'workspace-1',
    organizationId: null,
    billedAccountUserId: 'user-1',
    billingEntity: { type: 'user' as const, id: 'user-1' },
    billingPeriod: { start: '2026-07-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' },
    payerSubscription: null,
  },
} as Parameters<typeof runRowCascadeLoop>[0]

describe('draining another dispatch’s pre-stamped marker', () => {
  /**
   * The loop under test resolves its collaborators with dynamic imports, which
   * under a loaded parallel run can take whole seconds. Paying that cost inside
   * a test's own budget is what made this file flaky: one test timed out
   * mid-loop and its continuation spilled calls into the next. Warm the graph
   * once, outside any per-test budget.
   */
  beforeAll(async () => {
    await Promise.all([
      import('@/enrichments/registry'),
      import('@/enrichments/run'),
      import('@/lib/billing/core/usage-log'),
      import('@/lib/table/cell-write'),
      import('@/lib/table/dispatcher'),
      import('@/lib/table/rows/executions'),
      import('@/lib/table/rows/service'),
      import('@/lib/table/service'),
      import('@/lib/table/workflow-columns'),
      import('@/lib/workflows/executor/execute-workflow'),
      import('@/lib/workflows/persistence/utils'),
    ])
  }, 60_000)

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.getTableById.mockResolvedValue(TABLE)
    mocks.getEnrichment.mockReturnValue({
      id: 'enrich-1',
      name: 'Enrich',
      inputs: [{ id: 'domain', required: true }],
      outputs: [{ id: 'out' }],
    })
    mocks.checkAttributedUsageLimits.mockResolvedValue({ isExceeded: false })
    mocks.markWorkflowGroupPickedUp.mockResolvedValue('picked-up')
    mocks.writeWorkflowGroupState.mockResolvedValue('wrote')
    mocks.loadTableRowSecretProvenance.mockResolvedValue({
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
      byRowId: {},
    })
    mocks.runEnrichment.mockResolvedValue({ result: { out: 'x' }, cost: 0, detail: {} })
    mocks.readStampedCapabilitySubject.mockResolvedValue('requesting-member')
    // group-1 completes, then group-2 is picked up carrying an unclaimed marker.
    mocks.getRowById.mockResolvedValue({
      id: 'row-1',
      data: { domain: 'example.com' },
      executions: { 'group-2': { status: 'pending', executionId: null, workflowId: '' } },
    })
    mocks.pickNextEligibleGroupForRow
      .mockReturnValueOnce(enrichmentGroup('group-2'))
      .mockReturnValue(null)
  })

  /**
   * The lock owner drains markers it did not stamp. Running them under its own
   * subject applies the wrong person's tool denylist — and when the owner is an
   * actorless auto-fire, no denylist at all.
   */
  it('runs the drained cell under the subject stamped with it', async () => {
    await runRowCascadeLoop(CARRIER)

    expect(mocks.readStampedCapabilitySubject).toHaveBeenCalledWith('row-1', 'group-2')
    const subjects = mocks.runEnrichment.mock.calls.map(
      ([, , ctx]) => (ctx as { userId: string | null }).userId
    )
    expect(subjects).toEqual([null, 'requesting-member'])
  }, 20_000)
})
