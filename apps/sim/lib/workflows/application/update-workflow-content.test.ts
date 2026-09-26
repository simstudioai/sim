import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { realtimeNotifyMock, realtimeNotifyMockFns } from '@sim/testing/mocks/realtime-notify.mock'
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import {
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing/mocks/workflows-persistence-utils.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  requireMutable: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/workflows/application/context', () => workflowContextMock)

vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)
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

const mockLoadNormalized = workflowsPersistenceUtilsMockFns.mockLoadWorkflowFromNormalizedTables

const mockRecordAudit = auditMockFns.mockRecordAudit
const mockResolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockResolveContext = workflowContextMockFns.mockResolveActiveWorkflowApplicationContext
const mockNotify = realtimeNotifyMockFns.mockNotifyWorkflowUpdated

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
    resetDbChainMock()
    mockResolveContext.mockResolvedValue(context)
    mockResolvePermission.mockResolvedValue('write')
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
    expect(mockRecordAudit).toHaveBeenCalledWith(
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
    expect(mockNotify).toHaveBeenCalledWith('workflow-1')
    expect(dbChainMockFns.returning).toHaveBeenCalledBefore(mockNotify)
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
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
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

    expect(mockResolveContext).not.toHaveBeenCalled()
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
    resetDbChainMock()
    mockResolveContext.mockResolvedValue(context)
    mockResolvePermission.mockResolvedValue('write')
    mocks.requireMutable.mockResolvedValue(undefined)
    mockLoadNormalized.mockResolvedValue({
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

    mockLoadNormalized.mockClear()
    const tx = Symbol('tx')
    await expect(state(tx)).resolves.toEqual({
      blocks: { 'block-1': { ...BLOCK, enabled: false } },
      edges: [],
    })
    expect(mockLoadNormalized).toHaveBeenCalledWith('workflow-1', tx)
  })

  /** The returned state is what was persisted, not what was proposed. */
})
