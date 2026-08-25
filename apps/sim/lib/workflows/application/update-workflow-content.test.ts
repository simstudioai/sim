/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  resolveContext: vi.fn(),
  resolvePermission: vi.fn(),
  notify: vi.fn(),
  loadNormalized: vi.fn(),
  replace: vi.fn(),
  requireMutable: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    WORKFLOW_UPDATED: 'workflow.updated',
    WORKFLOW_VARIABLES_UPDATED: 'workflow.variables_updated',
  },
  AuditResourceType: { WORKFLOW: 'workflow' },
  recordAudit: mocks.recordAudit,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.resolveContext,
}))

vi.mock('@/lib/realtime/notify', () => ({ notifyWorkflowUpdated: mocks.notify }))
vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: mocks.loadNormalized,
}))
vi.mock('@/lib/workflows/persistence/replace-normalized-state', () => ({
  replaceWorkflowNormalizedState: mocks.replace,
}))
vi.mock('@/lib/workflows/application/workflow-mutability', () => ({
  requireMutableWorkflow: mocks.requireMutable,
}))

import {
  applyWorkflowVariableOperations,
  setWorkflowBlockEnabled,
} from '@/lib/workflows/application/update-workflow-content'

const context = {
  workflowId: 'workflow-1',
  workflow: { id: 'workflow-1', name: 'Workflow', workspaceId: 'workspace-1' },
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const principal = {
  kind: 'delegated' as const,
  serviceId: 'copilot' as const,
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'tool-call-1',
  audience: 'sim:workflows',
  issuedAt: new Date('2026-01-01T00:00:00Z'),
  expiresAt: new Date('2099-01-01T00:00:00Z'),
}

describe('applyWorkflowVariableOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.resolveContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('write')
    dbChainMockFns.for.mockResolvedValue([{ variables: {} }])
    dbChainMockFns.returning.mockResolvedValue([{ id: 'workflow-1' }])
  })

  it('transforms the row locked in the write transaction and projects effects afterward', async () => {
    dbChainMockFns.for.mockResolvedValueOnce([
      {
        variables: {
          concurrent: {
            id: 'concurrent',
            workflowId: 'workflow-1',
            name: 'preserved',
            type: 'plain',
            value: 'newer write',
          },
        },
      },
    ])

    await expect(
      applyWorkflowVariableOperations.execute({
        principal,
        input: {
          workflowId: 'workflow-1',
          operations: [{ operation: 'add', name: 'threshold', type: 'number', value: '5' }],
        },
      })
    ).resolves.toMatchObject({ updated: 2, changed: true })

    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          concurrent: expect.objectContaining({ value: 'newer write' }),
        }),
      })
    )
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workflow.variables_updated',
        resourceId: 'workflow-1',
        metadata: expect.objectContaining({
          operation: 'workflows.variables.apply_operations',
          operationCount: 1,
          source: 'copilot',
        }),
      })
    )
    expect(mocks.notify).toHaveBeenCalledWith('workflow-1')
    expect(dbChainMockFns.returning).toHaveBeenCalledBefore(mocks.notify)
  })

  it('does not write, audit, or notify an authoritative no-op', async () => {
    await expect(
      applyWorkflowVariableOperations.execute({
        principal,
        input: {
          workflowId: 'workflow-1',
          operations: [{ operation: 'delete', name: 'missing' }],
        },
      })
    ).resolves.toEqual({ updated: 0, changed: false })

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('admits a session principal and attributes the audit row to it, not to copilot', async () => {
    await expect(
      applyWorkflowVariableOperations.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          workflowId: 'workflow-1',
          operations: [{ operation: 'add', name: 'threshold', type: 'number', value: '5' }],
        },
      })
    ).resolves.toMatchObject({ changed: true })

    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ source: 'session' }),
      })
    )
  })

  it('rejects a delegated service the operation does not accept, before canonical loading', async () => {
    await expect(
      applyWorkflowVariableOperations.execute({
        principal: {
          kind: 'delegated',
          serviceId: 'executor',
          subjectUserId: 'user-1',
          workspaceId: 'workspace-1',
          delegationId: 'delegation-1',
          audience: 'sim:workflows',
          issuedAt: new Date('2026-01-01T00:00:00Z'),
          expiresAt: new Date('2026-01-01T01:00:00Z'),
        },
        input: { workflowId: 'workflow-1', operations: [] },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.resolveContext).not.toHaveBeenCalled()
  })
})

describe('setWorkflowBlockEnabled', () => {
  const BLOCK = {
    id: 'block-1',
    type: 'agent',
    name: 'Triage',
    position: { x: 0, y: 0 },
    subBlocks: {},
    outputs: {},
    enabled: true,
    data: {},
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.resolveContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.requireMutable.mockResolvedValue(undefined)
    mocks.loadNormalized.mockResolvedValue({
      blocks: { 'block-1': BLOCK },
      edges: [],
      loops: {},
      parallels: {},
    })
    mocks.replace.mockResolvedValue({
      warnings: [],
      state: { blocks: { 'block-1': { ...BLOCK, enabled: false } }, edges: [] },
    })
  })

  /**
   * The third graph-write door. It must not write the normalized tables itself:
   * bypassing the shared primitive is how it lost state preparation and
   * custom-tool extraction that `replaceWorkflowState` and
   * `applyWorkflowOperations` both get.
   */
  it('writes through the shared persistence primitive rather than saving the graph itself', async () => {
    await expect(
      setWorkflowBlockEnabled.execute({
        principal,
        input: { workflowId: 'workflow-1', blockId: 'block-1', enabled: false },
      })
    ).resolves.toMatchObject({ changed: true, affectedBlockIds: ['block-1'] })

    expect(mocks.replace).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      attributedUserId: 'user-1',
      state: expect.any(Function),
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  /**
   * The graph is produced inside the primitive's transaction, not handed to it
   * pre-read: the editor's own save takes the same row lock, so a graph read
   * before the lock can be a stale copy that this write — a whole graph, not a
   * delta — would persist over a concurrent autosave.
   */
  it('re-reads and re-decides inside the write transaction', async () => {
    await setWorkflowBlockEnabled.execute({
      principal,
      input: { workflowId: 'workflow-1', blockId: 'block-1', enabled: false },
    })

    const { state } = mocks.replace.mock.calls[0]![0]
    expect(typeof state).toBe('function')

    mocks.loadNormalized.mockClear()
    const tx = Symbol('tx')
    await expect(state(tx)).resolves.toEqual({
      blocks: { 'block-1': { ...BLOCK, enabled: false } },
      edges: [],
    })
    expect(mocks.loadNormalized).toHaveBeenCalledWith('workflow-1', tx)
  })

  /** The returned state is what was persisted, not what was proposed. */
  it('returns the graph the persistence primitive actually wrote', async () => {
    mocks.replace.mockResolvedValue({
      warnings: [],
      state: { blocks: { 'block-1': { ...BLOCK, enabled: false, name: 'Normalized' } }, edges: [] },
    })

    const result = await setWorkflowBlockEnabled.execute({
      principal,
      input: { workflowId: 'workflow-1', blockId: 'block-1', enabled: false },
    })

    expect(result.state.blocks['block-1'].name).toBe('Normalized')
  })

  it('does not write, audit, or notify an authoritative no-op', async () => {
    await expect(
      setWorkflowBlockEnabled.execute({
        principal,
        input: { workflowId: 'workflow-1', blockId: 'block-1', enabled: true },
      })
    ).resolves.toMatchObject({ changed: false })

    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })
})
