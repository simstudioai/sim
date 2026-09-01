/**
 * @vitest-environment node
 *
 * `logs.cost` is a PROJECTION, not a gate — `logOperations.readExecutionSnapshot`
 * correctly declares `capability: 'none'`, and the run stays readable while its
 * spend does not.
 *
 * The snapshot read applied none of it, on either of its two doors: the internal
 * `/api/logs/execution/{executionId}` route and the `logs_get_execution` Copilot
 * tool both presented `executionMetadata.cost` verbatim, so a member whose group
 * hides spend read the run total here after being withheld it everywhere else.
 * Projecting in the use case is what makes both doors inherit it, which is why
 * these exercise the use case against the real `resolveLogFieldProjection`.
 */
import {
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  resetPermissionGroupScopeMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  resolveWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  materialize: vi.fn(),
  hydrateChildTraces: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

vi.mock('@sim/db', () => ({ db: { select: mocks.select } }))

vi.mock('@sim/audit', () => ({
  AuditAction: {},
  AuditResourceType: {},
  recordAudit: mocks.recordAudit,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) =>
    actual === 'admin' || actual === 'write' || actual === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.resolveWorkspace,
}))

vi.mock('@/lib/logs/execution/trace-store', () => ({
  materializeExecutionData: mocks.materialize,
}))

vi.mock('@/lib/logs/execution/hydrate-child-traces', () => ({
  hydrateChildTraces: mocks.hydrateChildTraces,
}))

import { readExecutionSnapshotUseCase } from '@/lib/logs/application/read-execution-snapshot'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const WORKSPACE_ID = 'workspace-1'

const workspaceContext = {
  workspaceId: WORKSPACE_ID,
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const workflowRecord = {
  id: 'log-1',
  workflowId: 'workflow-1',
  workspaceId: WORKSPACE_ID,
  executionId: 'run-1',
  stateSnapshotId: 'snapshot-1',
  trigger: 'api',
  startedAt: new Date('2026-08-05T12:00:00.000Z'),
  endedAt: new Date('2026-08-05T12:00:01.000Z'),
  totalDurationMs: 1000,
  costTotal: '0.75',
  executionData: null,
}

const jobRecord = {
  id: 'job-log-1',
  workspaceId: WORKSPACE_ID,
  executionId: 'job-1',
  trigger: 'schedule',
  startedAt: new Date('2026-08-05T12:00:00.000Z'),
  endedAt: null,
  totalDurationMs: null,
  cost: { total: 0.75, input: 0.5, output: 0.25 },
}

/**
 * Answers `db.select(...)` calls in order. The snapshot read walks the workflow
 * log, then (only when that missed) the job log, then the state snapshot.
 */
function queueSelects(...results: unknown[][]): void {
  for (const rows of results) {
    mocks.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
    })
  }
}

const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
/**
 * `logs.read_execution_snapshot` denies a workspace API key outright, so the
 * subjectless caller that actually reaches this read is the executor delegation —
 * which carries a workspace role but no capabilities, and must read whole.
 */
const executorPrincipal = {
  kind: 'delegated' as const,
  serviceId: 'executor' as const,
  workspaceId: WORKSPACE_ID,
  delegationId: 'delegation-1',
  audience: 'sim:logs',
  issuedAt: new Date(Date.now() - 60_000),
  expiresAt: new Date(Date.now() + 60 * 60_000),
  delegationContext: {
    kind: 'workflow_execution' as const,
    workflowId: 'workflow-1',
    currentWorkflow: { mode: 'deployment' as const },
    /** Never the projection subject: it is compatibility policy, not the caller. */
    compatibilityActor: { kind: 'legacy_execution_user' as const, userId: 'user-1' },
  },
}

function read(actor: typeof principal | typeof executorPrincipal, executionId: string) {
  return readExecutionSnapshotUseCase.execute({
    principal: actor,
    input: { executionId },
  })
}

describe('readExecutionSnapshot spend projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetPermissionGroupScopeMock()
    mocks.resolveWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.materialize.mockResolvedValue(null)
  })

  it('reads the run total whole for a member no group governs', async () => {
    queueSelects([workflowRecord], [{ id: 'snapshot-1', stateData: { blocks: {} } }])

    const result = await read(principal, 'run-1')

    expect(result.executionMetadata.cost).toEqual({ total: 0.75 })
  })

  it('withholds the run total from a member whose group hides spend', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideCostInfo: true,
    })
    queueSelects([workflowRecord], [{ id: 'snapshot-1', stateData: { blocks: {} } }])

    const result = await read(principal, 'run-1')

    expect(result.executionMetadata.cost).toBeNull()
    expect(result.executionMetadata.trigger).toBe('api')
    expect(result.workflowState).toEqual({ blocks: {} })
  })

  /** A job run spells its spend as a jsonb document; the same rule covers it. */
  it("withholds a job run's spend document from a member whose group hides spend", async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideCostInfo: true,
    })
    queueSelects([], [jobRecord])

    const result = await read(principal, 'job-1')

    expect(result.executionMetadata.cost).toBeNull()
  })

  /**
   * A workspace API key authorizes as the workspace and represents no user, so
   * it resolves to no subject — the key's creator is never substituted.
   */
  it('reads whole and resolves no group for an executor delegation', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideCostInfo: true,
    })
    queueSelects([workflowRecord], [{ id: 'snapshot-1', stateData: { blocks: {} } }])

    const result = await read(executorPrincipal, 'run-1')

    expect(result.executionMetadata.cost).toEqual({ total: 0.75 })
    expect(permissionGroupScopeMockFns.mockResolvePermissionGroupConfig).not.toHaveBeenCalled()
  })
})
