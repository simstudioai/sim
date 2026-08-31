/**
 * @vitest-environment node
 *
 * `logs.trace_spans` and `logs.cost` are PROJECTIONS, not gates — a group
 * withholds those fields from the response rather than refusing the read, which
 * is why `logOperations.list` and `logOperations.readDetail` correctly declare
 * `capability: 'none'`.
 *
 * `/api/v2/logs` and `/api/v2/logs/{runId}` applied none of it: an enterprise
 * member whose group hides spend or execution detail read both in full through
 * a personal API key, while the same person was withheld them on the internal
 * and v1 surfaces. These run the real use cases against the real
 * `resolveLogFieldProjection` — the same helper `readLogDetail` and the v1
 * routes resolve their flags through — so they fail if this surface stops
 * projecting.
 */
import {
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  resetPermissionGroupScopeMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  getLogScope: vi.fn(),
  getLog: vi.fn(),
  listLogs: vi.fn(),
  loadFolders: vi.fn(),
  materialize: vi.fn(),
  buildCostLedger: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/logs/public-queries', () => ({
  getPublicWorkflowLogScope: mocks.getLogScope,
  getPublicWorkflowLog: mocks.getLog,
  readPublicLogPage: mocks.listLogs,
}))

vi.mock('@/lib/folders/queries', () => ({
  loadActiveFolderPathIndex: mocks.loadFolders,
}))

vi.mock('@/lib/logs/execution/trace-store', () => ({
  materializeExecutionDataForDisplay: mocks.materialize,
}))

vi.mock('@/lib/logs/cost-ledger', () => ({
  buildCostLedger: mocks.buildCostLedger,
}))

vi.mock('@/lib/logs/snapshot-sanitizer', () => ({
  sanitizeExecutionSnapshotState: (state: unknown) => state,
}))

vi.mock('@sim/audit', () => ({ recordAudit: mocks.recordAudit }))

import { getPublicLog } from '@/lib/logs/application/get-public-log'
import { listPublicLogs } from '@/lib/logs/application/list-public-logs'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const WORKSPACE_ID = 'workspace-1'

const workspaceContext = {
  workspaceId: WORKSPACE_ID,
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const EXECUTION_DATA = {
  /**
   * The run-level roll-up every completed run carries. `models` is the
   * per-model dollar breakdown, so a projection that blanks the total and
   * leaves this published the finer figure it was hiding.
   */
  tokens: { input: 60, output: 30, total: 90 },
  models: { 'gpt-4': { input: 0.4, output: 0.35, total: 0.75 } },
  finalOutput: { answer: 'a customer address' },
  workflowInput: { question: 'who?' },
  blockInput: { prompt: 'who?' },
  blockExecutions: [{ blockId: 'b1', cost: { total: 0.2 }, tokens: { total: 90 } }],
  traceSpans: [
    {
      id: 's1',
      name: 'agent',
      cost: { total: 0.5 },
      tokens: { total: 120 },
      children: [{ id: 's2', name: 'tool', cost: { total: 0.1 } }],
    },
  ],
}

const COST_LEDGER = { total: 0.75, items: [{ model: 'gpt-4', cost: 0.75 }] }

const workflowLog = {
  kind: 'workflow' as const,
  id: 'log-1',
  executionId: 'run-1',
  workspaceId: WORKSPACE_ID,
  workflowId: 'workflow-1',
  workflowName: 'Support triage',
  workflowFolderId: 'folder-1',
  workflowUserId: 'owner-1',
  workflowOwnerEmail: 'owner@example.com',
  workflowState: { blocks: {} },
  costTotal: '0.75',
  executionData: { pointer: true },
}

const jobLog = {
  kind: 'job' as const,
  executionId: 'job-1',
  cost: { total: 0.4 },
  executionData: { pointer: true },
}

/** A person governed by a group; the group's own keys decide what is withheld. */
const personalPrincipal = {
  kind: 'personal_api_key' as const,
  userId: 'user-9',
  keyId: 'key-9',
}

/** A workspace key has no user and therefore no group. */
const workspacePrincipal = {
  kind: 'workspace_api_key' as const,
  workspaceId: WORKSPACE_ID,
  keyId: 'key-1',
}

function governedBy(overrides: Partial<typeof DEFAULT_PERMISSION_GROUP_CONFIG>) {
  permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
    ...DEFAULT_PERMISSION_GROUP_CONFIG,
    ...overrides,
  })
}

function listInput(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE_ID,
    filters: {},
    sortBy: 'startedAt' as const,
    sortOrder: 'desc' as const,
    cursorKeys: undefined,
    limit: 50,
    includeFullDetails: true,
    includeFinalOutput: true,
    includeTraceSpans: true,
    includeJobRuns: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetPermissionGroupScopeMock()
  mocks.loadWorkspace.mockResolvedValue(workspaceContext)
  mocks.resolvePermission.mockResolvedValue('read')
  mocks.getLogScope.mockResolvedValue({
    executionId: 'run-1',
    workspaceId: WORKSPACE_ID,
    workflowId: 'workflow-1',
  })
  mocks.getLog.mockResolvedValue(workflowLog)
  mocks.listLogs.mockResolvedValue({ data: [workflowLog], nextCursorKeys: null })
  mocks.loadFolders.mockResolvedValue({
    idByPath: new Map([['/agents', 'folder-1']]),
    pathById: new Map([['folder-1', '/agents']]),
  })
  mocks.materialize.mockImplementation(async () => structuredClone(EXECUTION_DATA))
  mocks.buildCostLedger.mockResolvedValue(structuredClone(COST_LEDGER))
})

describe('listPublicLogs field projection', () => {
  it('blanks the run cost on the row when the group hides cost', async () => {
    governedBy({ hideCostInfo: true })

    const result = await listPublicLogs.execute({
      principal: personalPrincipal,
      input: listInput(),
    })

    expect((result.items[0].log as { costTotal: string | null }).costTotal).toBeNull()
  })

  it('blanks a job run cost too, which the presenter reads from another column', async () => {
    governedBy({ hideCostInfo: true })
    mocks.listLogs.mockResolvedValueOnce({ data: [jobLog], nextCursorKeys: null })

    const result = await listPublicLogs.execute({
      principal: personalPrincipal,
      input: listInput({ includeJobRuns: true }),
    })

    expect((result.items[0].log as { cost: unknown }).cost).toBeNull()
  })

  it('strips spend from the spans it still returns when only cost is hidden', async () => {
    governedBy({ hideCostInfo: true })

    const result = await listPublicLogs.execute({
      principal: personalPrincipal,
      input: listInput(),
    })
    const [span] = result.items[0].executionData?.traceSpans as Array<Record<string, unknown>>

    expect(result.items[0].executionData).not.toHaveProperty('models')
    expect(span.name).toBe('agent')
    expect(span).not.toHaveProperty('cost')
    expect(span).not.toHaveProperty('tokens')
    expect((span.children as Array<Record<string, unknown>>)[0]).not.toHaveProperty('cost')
  })

  /**
   * The flags are what the presenter renders from. Deleting the payloads alone
   * is not enough: it reads `executionData.traceSpans ?? []`, so a deleted
   * array would come back as an empty one — present, and indistinguishable from
   * a run whose spans aged out.
   */
  it('withholds the execution payloads and turns off their render flags', async () => {
    governedBy({ hideTraceSpans: true })

    const result = await listPublicLogs.execute({
      principal: personalPrincipal,
      input: listInput(),
    })

    expect(result.includeTraceSpans).toBe(false)
    expect(result.includeFinalOutput).toBe(false)
    expect(result.items[0].executionData).toBeUndefined()
  })

  /**
   * The page is withheld whole, so the object-store read and the secret
   * projection behind every payload buy nothing. Asserted on the read itself,
   * not only on `materializeExecutionDataForDisplay`, because the column is
   * what the work hangs off.
   */
  it('materializes nothing when the group withholds execution detail', async () => {
    governedBy({ hideTraceSpans: true })

    await listPublicLogs.execute({ principal: personalPrincipal, input: listInput() })

    expect(mocks.materialize).not.toHaveBeenCalled()
    expect(mocks.listLogs).toHaveBeenCalledWith(
      expect.objectContaining({ includeExecutionData: false })
    )
  })

  it('still materializes for a group that withholds only spend', async () => {
    governedBy({ hideCostInfo: true })

    await listPublicLogs.execute({ principal: personalPrincipal, input: listInput() })

    expect(mocks.materialize).toHaveBeenCalledTimes(1)
  })

  it('withholds nothing from a caller no group governs', async () => {
    const result = await listPublicLogs.execute({
      principal: personalPrincipal,
      input: listInput(),
    })

    expect((result.items[0].log as { costTotal: string | null }).costTotal).toBe('0.75')
    expect(result.includeTraceSpans).toBe(true)
    expect(result.items[0].executionData?.traceSpans).toHaveLength(1)
    expect(result.items[0].executionData?.finalOutput).toEqual(EXECUTION_DATA.finalOutput)
  })

  /**
   * A workspace API key authorizes as the workspace and represents no user, so
   * there is no group to apply. Substituting the key's creator would govern
   * every caller of a shared credential by a bystander's group.
   */
  it('withholds nothing from a workspace API key and never resolves a group', async () => {
    governedBy({ hideTraceSpans: true, hideCostInfo: true })

    const result = await listPublicLogs.execute({
      principal: workspacePrincipal,
      input: listInput(),
    })

    expect(permissionGroupScopeMockFns.mockResolvePermissionGroupConfig).not.toHaveBeenCalled()
    expect((result.items[0].log as { costTotal: string | null }).costTotal).toBe('0.75')
    expect(result.includeTraceSpans).toBe(true)
    expect(result.items[0].executionData?.traceSpans).toHaveLength(1)
  })
})

/**
 * Withholding the figure is not enough on its own: `minCost`/`maxCost` bisect
 * it, and `sortBy=cost` reads it as a ranking. Refused rather than dropped —
 * dropping the clause answers a question nobody asked.
 */
describe('listPublicLogs cost-selective queries', () => {
  it.each([
    ['a cost sort', { sortBy: 'cost' as const }],
    ['a minCost filter', { filters: { minCost: 0.5 } }],
    ['a maxCost filter', { filters: { maxCost: 0.5 } }],
  ])('refuses %s for a group that withholds spend', async (_label, overrides) => {
    governedBy({ hideCostInfo: true })

    await expect(
      listPublicLogs.execute({ principal: personalPrincipal, input: listInput(overrides) })
    ).rejects.toMatchObject({
      code: 'forbidden',
      detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
      message: "Execution cost is not available under your organization's permission group",
    })

    expect(mocks.listLogs).not.toHaveBeenCalled()
  })

  it('answers a cost sort for a group that withholds nothing', async () => {
    await listPublicLogs.execute({
      principal: personalPrincipal,
      input: listInput({ sortBy: 'cost' as const }),
    })

    expect(mocks.listLogs).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'cost' }))
  })

  it('answers a cost filter for a workspace API key', async () => {
    governedBy({ hideCostInfo: true })

    await listPublicLogs.execute({
      principal: workspacePrincipal,
      input: listInput({ filters: { minCost: 0.5 } }),
    })

    expect(mocks.listLogs).toHaveBeenCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ minCost: 0.5 }) })
    )
  })

  it('leaves a non-spend filter alone for a group that withholds spend', async () => {
    governedBy({ hideCostInfo: true })

    await listPublicLogs.execute({
      principal: personalPrincipal,
      input: listInput({ filters: { minDurationMs: 100 } }),
    })

    expect(mocks.listLogs).toHaveBeenCalled()
  })
})

describe('getPublicLog field projection', () => {
  it('withholds the run total and the itemized ledger when the group hides cost', async () => {
    governedBy({ hideCostInfo: true })

    const result = await getPublicLog.execute({
      principal: personalPrincipal,
      input: { runId: 'run-1' },
    })

    expect(result.log.costTotal).toBeNull()
    expect(result.costLedger).toBeNull()
    expect(
      (result.executionData.traceSpans as Array<Record<string, unknown>>)[0]
    ).not.toHaveProperty('cost')
    expect(
      (result.executionData.blockExecutions as Array<Record<string, unknown>>)[0]
    ).not.toHaveProperty('tokens')
    expect(result.executionData).not.toHaveProperty('tokens')
    expect(result.executionData).not.toHaveProperty('models')
  })

  it('withholds the execution payloads when the group hides trace spans', async () => {
    governedBy({ hideTraceSpans: true })

    const result = await getPublicLog.execute({
      principal: personalPrincipal,
      input: { runId: 'run-1' },
    })

    expect(result.executionData).not.toHaveProperty('traceSpans')
    expect(result.executionData).not.toHaveProperty('finalOutput')
    expect(result.executionData).not.toHaveProperty('workflowInput')
    expect(result.executionData).not.toHaveProperty('blockExecutions')
  })

  it('withholds nothing from a caller no group governs', async () => {
    const result = await getPublicLog.execute({
      principal: personalPrincipal,
      input: { runId: 'run-1' },
    })

    expect(result.log.costTotal).toBe('0.75')
    expect(result.costLedger).toEqual(COST_LEDGER)
    expect(result.executionData.finalOutput).toEqual(EXECUTION_DATA.finalOutput)
    expect(result.executionData.models).toEqual(EXECUTION_DATA.models)
  })

  it('withholds nothing from a workspace API key', async () => {
    governedBy({ hideTraceSpans: true, hideCostInfo: true })

    const result = await getPublicLog.execute({
      principal: workspacePrincipal,
      input: { runId: 'run-1' },
    })

    expect(permissionGroupScopeMockFns.mockResolvePermissionGroupConfig).not.toHaveBeenCalled()
    expect(result.log.costTotal).toBe('0.75')
    expect(result.costLedger).toEqual(COST_LEDGER)
    expect(result.executionData.traceSpans).toHaveLength(1)
  })
})
