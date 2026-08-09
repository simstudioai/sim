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
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { WORKFLOW_VARIABLES_UPDATED: 'workflow.variables_updated' },
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

import { applyWorkflowVariableOperations } from '@/lib/workflows/application/update-workflow-content'

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

  it('rejects a non-Copilot principal before canonical loading', async () => {
    await expect(
      applyWorkflowVariableOperations.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workflowId: 'workflow-1', operations: [] },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.resolveContext).not.toHaveBeenCalled()
  })
})
