/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePermission: vi.fn(),
  authorizeOrganization: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { KNOWLEDGE_BASE_UPDATED: 'knowledge_base.updated' },
  AuditResourceType: { KNOWLEDGE_BASE: 'knowledge_base' },
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

vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: mocks.authorizeOrganization,
}))

import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'owner-1',
  knowledgeBaseId: 'knowledge-1',
}
const organizationContext = {
  workspaceId: undefined,
  organizationId: 'organization-1',
  knowledgeBaseId: 'knowledge-1',
}

const session = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const

function useCaseFor(context: object) {
  const execute = vi.fn(async () => 'done')
  const useCase = defineAuthorizedKnowledgeUseCase({
    operation: knowledgeOperations.read,
    resolveContext: () => context as never,
    execute,
    projectAudit: () => ({
      action: 'knowledge_base.updated',
      resourceType: 'knowledge_base',
      resourceId: 'knowledge-1',
      resourceName: 'Docs',
      description: 'audited',
      metadata: {},
    }),
  })
  return { useCase, execute }
}

describe('defineAuthorizedKnowledgeUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.authorizeOrganization.mockResolvedValue(undefined)
  })

  /** `authorize` must run the same funnel `execute` does, and nothing else. */
  it('authorizes a workspace base through the workspace funnel without executing', async () => {
    const { useCase, execute } = useCaseFor(workspaceContext)

    await useCase.authorize({ principal: session, input: {} })
    expect(mocks.resolvePermission).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()

    mocks.resolvePermission.mockResolvedValue(null)
    await expect(useCase.authorize({ principal: session, input: {} })).rejects.toMatchObject({
      name: 'NoWorkspaceAccessError',
    })
  })

  it('executes a workspace base and records its audit under the workspace', async () => {
    const { useCase } = useCaseFor(workspaceContext)

    await expect(useCase.execute({ principal: session, input: {} })).resolves.toBe('done')
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-1', resourceId: 'knowledge-1' })
    )
  })

  it('authorizes and executes an organization base through the organization operation', async () => {
    const { useCase, execute } = useCaseFor(organizationContext)

    await useCase.authorize({ principal: session, input: {} })
    expect(mocks.authorizeOrganization).toHaveBeenCalledWith(
      session,
      knowledgeOperations.read.organizationOperation,
      organizationContext
    )
    expect(execute).not.toHaveBeenCalled()
    expect(mocks.resolvePermission).not.toHaveBeenCalled()

    await expect(useCase.execute({ principal: session, input: {} })).resolves.toBe('done')
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: undefined,
        resourceId: 'knowledge-1',
        metadata: expect.objectContaining({ organizationId: 'organization-1' }),
      })
    )
  })
})
