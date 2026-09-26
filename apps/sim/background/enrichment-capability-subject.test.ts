import { resetDbChainMock } from '@sim/testing'
import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import {
  billingUsageGateCacheMock,
  billingUsageGateCacheMockFns,
} from '@sim/testing/mocks/billing-usage-gate-cache.mock'
import { executeWorkflowMock } from '@sim/testing/mocks/execute-workflow.mock'
import { networkConfigMock, networkConfigMockFns } from '@sim/testing/mocks/network-config.mock'
import { tableEventsMock } from '@sim/testing/mocks/table-events.mock'
import {
  tableRowsSecretProvenanceMock,
  tableRowsSecretProvenanceMockFns,
} from '@sim/testing/mocks/table-rows-secret-provenance.mock'
import {
  tableRowsServiceMock,
  tableRowsServiceMockFns,
} from '@sim/testing/mocks/table-rows-service.mock'
import { tableServiceMock, tableServiceMockFns } from '@sim/testing/mocks/table-service.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
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
}))

vi.mock('@/lib/core/network/config.server', () => networkConfigMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

vi.mock('@/lib/table/service', () => tableServiceMock)
vi.mock('@/lib/table/rows/service', () => tableRowsServiceMock)
vi.mock('@/lib/table/cell-write', () => ({
  writeWorkflowGroupState: hoisted.writeWorkflowGroupState,
  markWorkflowGroupPickedUp: hoisted.markWorkflowGroupPickedUp,
  createWorkflowCellProgressWriter: hoisted.createWorkflowCellProgressWriter,
  buildCancelledExecution: hoisted.buildCancelledExecution,
}))
vi.mock('@/lib/table/workflow-cell-result', () => ({
  classifyWorkflowCellTerminalResult: hoisted.classifyWorkflowCellTerminalResult,
}))
vi.mock('@/lib/workflows/executor/execute-workflow', () => executeWorkflowMock)
vi.mock('@/enrichments/registry', () => ({ getEnrichment: hoisted.getEnrichment }))
vi.mock('@/enrichments/run', () => ({
  runEnrichment: hoisted.runEnrichment,
  skippedEnrichmentDetail: hoisted.skippedEnrichmentDetail,
}))
vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)
vi.mock('@/lib/billing/core/usage-gate-cache', () => billingUsageGateCacheMock)
vi.mock('@/lib/table/rows/secret-provenance', () => tableRowsSecretProvenanceMock)
vi.mock('@/executor/utils/resolved-secret-trace-registry', () => ({
  ResolvedSecretTraceRegistry: class {
    async importCrossingProvenance() {}
  },
}))
vi.mock('@/lib/table/events', () => tableEventsMock)

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

import { resolveCurrentOutboundRoute } from '@/lib/core/network/context.server'
import { runRowCascadeLoop } from '@/background/workflow-column-execution'

const mocks = {
  ...hoisted,
  resolveOutboundRoute: networkConfigMockFns.mockResolveOutboundRoute,
  getRowById: tableRowsServiceMockFns.mockGetRowById,
  getRowSummaryById: tableRowsServiceMockFns.mockGetRowSummaryById,
  updateRow: tableRowsServiceMockFns.mockUpdateRow,
  createProvenanceReader: tableRowsSecretProvenanceMockFns.mockTableRowProvenanceReader,
  checkAttributedUsageLimits: billingUsageGateCacheMockFns.mockCheckExecutionUsageLimits,
  exportProvenance: tableRowsSecretProvenanceMockFns.mockTableRowProvenanceReaderExportProvenance,
}

const mockGetTableById = tableServiceMockFns.mockGetTableById
const mockLoadWorkspaceApplicationContext =
  workspaceContextMockFns.mockLoadWorkspaceApplicationContext as Mock
billingAttributionMockFns.mockToBillingContext.mockReturnValue({} as never)
networkConfigMockFns.mockIsOutboundRoutingEnabled.mockReturnValue(true)
mocks.checkAttributedUsageLimits.mockResolvedValue({ isExceeded: false })
mocks.exportProvenance.mockReturnValue({ scope: null, entries: [] } as never)
tableRowsSecretProvenanceMockFns.mockCreateExactEmptyTableRowSecretProvenance.mockReturnValue(
  undefined as never
)
tableRowsSecretProvenanceMockFns.mockCreateTableRowSecretProvenanceFromRegistry.mockReturnValue(
  undefined as never
)

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
    resetDbChainMock()
    mocks.getRowSummaryById.mockImplementation((tableId, rowId, workspaceId) =>
      mocks.getRowById(tableId, rowId, workspaceId)
    )
    mockLoadWorkspaceApplicationContext.mockResolvedValue({ workspaceOrganizationId: null })
    mockGetTableById.mockResolvedValue(TABLE)
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

  it('builds enrichment inputs from the captured row after pickup and excludes own outputs', async () => {
    mockGetTableById.mockResolvedValue({
      ...TABLE,
      schema: {
        ...TABLE.schema,
        workflowGroups: [
          {
            ...GROUP,
            inputMappings: [
              ...GROUP.inputMappings,
              { columnName: 'col-out', inputName: 'excluded' },
            ],
          },
        ],
      },
    })
    mocks.getRowSummaryById.mockResolvedValue({
      id: 'row-1',
      data: { 'col-in': 'fresh.example.com', 'col-out': 'secret-output' },
      updatedAt: new Date('2026-09-14T00:00:00Z'),
    })

    await runRowCascadeLoop(payload('acting-user', 'acting-user') as never)

    expect(mocks.getRowSummaryById).toHaveBeenCalledWith(
      'table-1',
      'row-1',
      'workspace-1',
      expect.any(Object)
    )
    expect(mocks.createProvenanceReader).toHaveBeenCalledExactlyOnceWith(
      { userId: 'acting-user', workspaceId: 'workspace-1' },
      new Set(['col-in'])
    )
    expect(mocks.runEnrichment.mock.calls[0][1]).toEqual({ domain: 'fresh.example.com' })
    expect(mocks.markWorkflowGroupPickedUp.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getRowSummaryById.mock.invocationCallOrder[0]
    )
    expect(mocks.getRowSummaryById.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runEnrichment.mock.invocationCallOrder[0]
    )
  })

  it.each(['org_reserved', 'org_other', null])(
    'restores the current workspace owner %s before running a queued enrichment',
    async (organizationId) => {
      mockLoadWorkspaceApplicationContext.mockResolvedValue({
        workspaceOrganizationId: organizationId,
      })
      mocks.runEnrichment.mockImplementationOnce(async () => {
        await resolveCurrentOutboundRoute()
        return { result: {}, cost: 0, detail: {} }
      })

      await runRowCascadeLoop(payload(null, 'billing-owner') as never)

      expect(mocks.resolveOutboundRoute).toHaveBeenCalledExactlyOnceWith(organizationId)
      expect(mockLoadWorkspaceApplicationContext).toHaveBeenCalledWith('workspace-1', {})
    }
  )

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
