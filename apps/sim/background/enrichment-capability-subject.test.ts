/**
 * @vitest-environment node
 */
import { resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getTableById: vi.fn(),
  getRowById: vi.fn(),
  updateRow: vi.fn(),
  pickNextEligibleGroupForRow: vi.fn(),
  stashCellContextForResume: vi.fn(),
  writeWorkflowGroupState: vi.fn(async () => 'wrote'),
  markWorkflowGroupPickedUp: vi.fn(async () => 'wrote'),
  createWorkflowCellProgressWriter: vi.fn(),
  buildCancelledExecution: vi.fn(),
  classifyWorkflowCellTerminalResult: vi.fn(),
  getEnrichment: vi.fn(),
  runEnrichment: vi.fn(),
  skippedEnrichmentDetail: vi.fn(() => ({})),
  checkAttributedUsageLimits: vi.fn(async () => ({ isExceeded: false })),
  loadTableRowSecretProvenance: vi.fn(async () => ({ scope: null, entries: [] })),
}))

vi.mock('@/lib/table/service', () => ({ getTableById: mocks.getTableById }))
vi.mock('@/lib/table/rows/service', () => ({
  getRowById: mocks.getRowById,
  updateRow: mocks.updateRow,
}))
vi.mock('@/lib/table/cell-write', () => ({
  writeWorkflowGroupState: mocks.writeWorkflowGroupState,
  markWorkflowGroupPickedUp: mocks.markWorkflowGroupPickedUp,
  createWorkflowCellProgressWriter: mocks.createWorkflowCellProgressWriter,
  buildCancelledExecution: mocks.buildCancelledExecution,
}))
vi.mock('@/lib/table/workflow-cell-result', () => ({
  classifyWorkflowCellTerminalResult: mocks.classifyWorkflowCellTerminalResult,
}))
vi.mock('@/enrichments/registry', () => ({ getEnrichment: mocks.getEnrichment }))
vi.mock('@/enrichments/run', () => ({
  runEnrichment: mocks.runEnrichment,
  skippedEnrichmentDetail: mocks.skippedEnrichmentDetail,
}))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionSnapshot: vi.fn((value) => value),
  checkAttributedUsageLimits: mocks.checkAttributedUsageLimits,
  toBillingContext: vi.fn(() => ({})),
}))
vi.mock('@/lib/table/rows/secret-provenance', () => ({
  createExactEmptyTableRowSecretProvenance: vi.fn(() => undefined),
  createTableRowSecretProvenanceFromRegistry: vi.fn(() => undefined),
  loadTableRowSecretProvenance: mocks.loadTableRowSecretProvenance,
}))
vi.mock('@/executor/utils/resolved-secret-trace-registry', () => ({
  ResolvedSecretTraceRegistry: class {
    async importCrossingProvenance() {}
  },
}))
vi.mock('@/lib/table/events', () => ({ appendTableEvent: vi.fn() }))

import { runRowCascadeLoop } from '@/background/workflow-column-execution'

const GROUP = {
  id: 'group-1',
  type: 'enrichment' as const,
  enrichmentId: 'company-lookup',
  workflowId: '',
  outputs: [{ columnName: 'col-out', blockId: '', path: '' }],
  inputMappings: [{ columnName: 'col-in', inputName: 'domain' }],
}

const TABLE = {
  id: 'table-1',
  workspaceId: 'workspace-1',
  schema: { columns: [{ id: 'col-in', name: 'Domain', type: 'string' }], workflowGroups: [GROUP] },
}

function payload(capabilityGovernedUserId: string | null, triggeredByUserId?: string) {
  return {
    tableId: 'table-1',
    tableName: 'Table',
    rowId: 'row-1',
    groupId: 'group-1',
    workflowId: '',
    workspaceId: 'workspace-1',
    executionId: 'exec-1',
    capabilityGovernedUserId,
    ...(triggeredByUserId ? { triggeredByUserId } : {}),
    billingAttribution: {
      /** The meter's subject: the payer a workspace-key run attributes to. */
      actorUserId: triggeredByUserId ?? 'billing-owner',
      workspaceId: 'workspace-1',
      organizationId: null,
      billedAccountUserId: 'billing-owner',
      billingEntity: { type: 'user' as const, id: 'billing-owner' },
      billingPeriod: { start: '2026-07-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' },
      payerSubscription: null,
    },
  }
}

/** The `userId` the cell handed the enrichment run — the per-tool gate subject. */
function gatedUserId(): unknown {
  expect(mocks.runEnrichment).toHaveBeenCalledTimes(1)
  return (mocks.runEnrichment.mock.calls[0][2] as { userId?: unknown }).userId
}

describe('enrichment cell capability subject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.getTableById.mockResolvedValue(TABLE)
    mocks.getRowById.mockResolvedValue({
      id: 'row-1',
      data: { 'col-in': 'example.com' },
      executions: {},
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    })
    mocks.checkAttributedUsageLimits.mockResolvedValue({ isExceeded: false })
    mocks.markWorkflowGroupPickedUp.mockResolvedValue('wrote')
    mocks.writeWorkflowGroupState.mockResolvedValue('wrote')
    mocks.pickNextEligibleGroupForRow.mockResolvedValue(null)
    mocks.getEnrichment.mockReturnValue({
      id: 'company-lookup',
      inputs: [{ id: 'domain', required: true }],
      providers: [],
    })
    mocks.runEnrichment.mockResolvedValue({ result: {}, cost: 0, detail: {} })
  })

  /**
   * A workspace-key write is actorless: nobody's permission group governs it,
   * and the billing owner beside it on the payload is a bystander. Handing that
   * bystander to the enrichment would run their tool denylist against a request
   * they never made.
   */
  it('runs a workspace-key dispatch ungated even though the payload names a payer', async () => {
    await runRowCascadeLoop(payload(null, 'billing-owner') as never)
    expect(gatedUserId()).toBeNull()
  })

  it('governs a session-triggered dispatch by the acting person', async () => {
    await runRowCascadeLoop(payload('acting-user', 'acting-user') as never)
    expect(gatedUserId()).toBe('acting-user')
  })

  /**
   * The shape a pre-0315 dispatch row has after the column is added: no governed
   * subject, attribution intact. New code reads that as actorless, which is why
   * the migration backfills the legacy subject onto non-terminal old rows rather
   * than letting the reader reconstruct it here.
   */
  it('does not fall back to the attribution when the governed subject is absent', async () => {
    await runRowCascadeLoop(payload(null, 'legacy-trigger-user') as never)
    expect(gatedUserId()).toBeNull()
  })
})
