/**
 * @vitest-environment node
 */
import { WorkflowLockedError } from '@sim/platform-authz/workflow'
import { workflowAuthzMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  resolveContext: vi.fn(),
  resolvePermission: vi.fn(),
  notify: vi.fn(),
  replace: vi.fn(),
  validate: vi.fn(),
  needsRedeployment: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { WORKFLOW_UPDATED: 'workflow.updated' },
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
vi.mock('@/lib/workflows/persistence/replace-normalized-state', () => ({
  replaceWorkflowNormalizedState: mocks.replace,
}))
vi.mock('@/lib/workflows/sanitization/validation', () => ({
  validateWorkflowState: mocks.validate,
}))
vi.mock('@/lib/workflows/deployment-status', () => ({
  checkNeedsRedeployment: mocks.needsRedeployment,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { replaceWorkflowState } from '@/lib/workflows/application/replace-workflow-state'

const BLOCK = {
  id: 'block-1',
  type: 'starter',
  name: 'Start',
  position: { x: 0, y: 0 },
  subBlocks: {},
  outputs: {},
  enabled: true,
}

const context = {
  workflowId: 'workflow-1',
  workflow: { id: 'workflow-1', name: 'Daily digest', workspaceId: 'workspace-1' },
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const sessionPrincipal = {
  kind: 'session' as const,
  userId: 'user-1',
  sessionId: 'session-1',
}

const input = { workflowId: 'workflow-1', blocks: { 'block-1': BLOCK }, edges: [] }

describe('replaceWorkflowState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('write')
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockResolvedValue(undefined)
    mocks.validate.mockReturnValue({ valid: true, errors: [], warnings: [] })
    mocks.replace.mockResolvedValue({
      warnings: [],
      state: { blocks: { 'block-1': BLOCK }, edges: [], loops: {}, parallels: {} },
    })
    mocks.needsRedeployment.mockResolvedValue(true)
  })

  /**
   * Two things this pins that a same-shape input and output cannot: the write
   * carries the **sanitized** graph, not the caller's body, and the reported
   * counts come from what was persisted, not from what was asked for. The
   * fixture deliberately makes the two differ.
   */
  it('writes the sanitized graph and counts what was persisted, not what was sent', async () => {
    const DROPPED_BLOCK = { ...BLOCK, id: 'block-2', name: 'Dropped' }
    const DROPPED_EDGE = { id: 'edge-9', source: 'block-1', target: 'block-2' }
    mocks.validate.mockReturnValue({
      valid: true,
      errors: [],
      warnings: ['Dropped block "block-2"'],
      sanitizedState: { blocks: { 'block-1': BLOCK }, edges: [], loops: {}, parallels: {} },
    })

    await expect(
      replaceWorkflowState.execute({
        principal: sessionPrincipal,
        input: {
          workflowId: 'workflow-1',
          blocks: { 'block-1': BLOCK, 'block-2': DROPPED_BLOCK },
          edges: [DROPPED_EDGE],
        },
      })
    ).resolves.toMatchObject({
      workflowId: 'workflow-1',
      blocksCount: 1,
      edgesCount: 0,
      needsRedeployment: true,
    })

    expect(mocks.replace).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      attributedUserId: 'user-1',
      state: { blocks: { 'block-1': BLOCK }, edges: [], variables: undefined },
    })
  })

  it('derives the audit source from the acting principal and notifies after it', async () => {
    await replaceWorkflowState.execute({ principal: sessionPrincipal, input })

    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workflow.updated',
        resourceId: 'workflow-1',
        resourceName: 'Daily digest',
        metadata: expect.objectContaining({
          operation: 'workflows.state.replace',
          op: 'replace_state',
          blocksCount: 1,
          source: 'session',
        }),
      })
    )
    expect(mocks.recordAudit).toHaveBeenCalledBefore(mocks.notify)
    expect(mocks.notify).toHaveBeenCalledWith('workflow-1')
  })

  it('names the delegated service rather than the principal kind', async () => {
    await replaceWorkflowState.execute({
      principal: {
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-1',
        workspaceId: 'workspace-1',
        delegationId: 'tool-call-1',
        audience: 'sim:workflows',
        issuedAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2099-01-01T00:00:00Z'),
      },
      input,
    })

    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ source: 'copilot' }) })
    )
  })

  it('refuses a role below the operation floor', async () => {
    mocks.resolvePermission.mockResolvedValue('read')

    await expect(
      replaceWorkflowState.execute({ principal: sessionPrincipal, input })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('rejects a principal kind the operation does not accept before canonical loading', async () => {
    await expect(
      replaceWorkflowState.execute({
        principal: {
          kind: 'credential_group_enrollment',
          workspaceId: 'workspace-1',
          credentialGroupId: 'group-1',
          enrollmentId: 'enrollment-1',
          email: 'someone@example.com',
          invitationTokenHash: 'hash',
        },
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.resolveContext).not.toHaveBeenCalled()
  })

  it('conceals an asserted-workspace mismatch as not found', async () => {
    mocks.resolveContext.mockRejectedValue(
      new OrchestrationError('not_found', 'Workflow not found')
    )

    await expect(
      replaceWorkflowState.execute({
        principal: sessionPrincipal,
        input: { ...input, assertedWorkspaceId: 'other-workspace' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('refuses a locked workflow before validating or writing', async () => {
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockRejectedValue(
      new WorkflowLockedError('Workflow is locked')
    )

    await expect(
      replaceWorkflowState.execute({ principal: sessionPrincipal, input })
    ).rejects.toMatchObject({ code: 'locked' })

    expect(mocks.validate).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('rejects a semantically invalid graph without writing', async () => {
    mocks.validate.mockReturnValue({
      valid: false,
      errors: ['Edge references an unknown block'],
      warnings: [],
    })

    await expect(
      replaceWorkflowState.execute({ principal: sessionPrincipal, input })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('records neither audit nor notification when the write fails', async () => {
    mocks.replace.mockRejectedValue(new Error('constraint violation'))

    await expect(
      replaceWorkflowState.execute({ principal: sessionPrincipal, input })
    ).rejects.toThrow('constraint violation')

    expect(mocks.recordAudit).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })
})
