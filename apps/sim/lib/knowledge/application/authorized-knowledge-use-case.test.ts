import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)

import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

const mockAuthorizeOrganization =
  organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation

const mocks = {
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  authorizeOrganization: mockAuthorizeOrganization,
  recordAudit: auditMockFns.mockRecordAudit,
}

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

const session = createSessionPrincipal()

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
