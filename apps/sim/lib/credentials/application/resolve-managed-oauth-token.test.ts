import {
  createExecutorPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock } from '@sim/testing/mocks/audit.mock'
import {
  credentialsManagedOauthMock,
  credentialsManagedOauthMockFns,
} from '@sim/testing/mocks/credentials-managed-oauth.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  requireCredentialAccess: vi.fn(),
}))

vi.mock('@/lib/credentials/managed-oauth', () => credentialsManagedOauthMock)

vi.mock('@/lib/credential-groups/application/authorization', () => ({
  requireCredentialGroupCredentialAccess: hoisted.requireCredentialAccess,
}))

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@sim/audit', () => auditMock)

import { resolveManagedOAuthCredentialToken } from '@/lib/credentials/application/resolve-managed-oauth-token'

const mocks = {
  ...hoisted,
  loadContext: credentialsManagedOauthMockFns.mockLoadManagedOAuthCredentialApplicationContext,
  resolveToken: credentialsManagedOauthMockFns.mockResolveManagedOAuthToken,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

const context = {
  credentialId: 'credential-1',
  credentialGroupId: 'group-1',
  credentialGroupEnrollmentId: 'enrollment-1',
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
}

const input = {
  credentialId: 'credential-1',
  expectedProviderId: 'google-email',
  requiredScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  toolId: 'gmail_read',
}

function executorPrincipal(credentialId = 'credential-1') {
  return createExecutorPrincipal({
    audience: 'sim:managed-oauth-credentials',
    resourceScope: { credentialId },
    delegationContext: {
      kind: 'workflow_execution',
      workflowId: 'workflow-1',
      principal: createSessionPrincipal(),
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment',
        deploymentVersionId: 'version-1',
      },
    },
  })
}

describe('resolveManagedOAuthCredentialToken', () => {
  beforeEach(() => {
    mocks.loadContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.requireCredentialAccess.mockResolvedValue(undefined)
    mocks.resolveToken.mockResolvedValue({ accessToken: 'access-token', refreshed: false })
  })

  it('rejects a delegation scoped to another credential', async () => {
    await expect(
      resolveManagedOAuthCredentialToken.execute({
        principal: executorPrincipal('credential-2'),
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.resolveToken).not.toHaveBeenCalled()
  })

  it('does not resolve token material when the resource policy denies access', async () => {
    mocks.requireCredentialAccess.mockRejectedValueOnce({
      code: 'forbidden',
      message: 'Credential Group credential access denied',
    })

    await expect(
      resolveManagedOAuthCredentialToken.execute({ principal: executorPrincipal(), input })
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: 'Credential Group credential access denied',
    })
    expect(mocks.resolveToken).not.toHaveBeenCalled()
  })

  it('allows token resolution after any policy allow, including workflow-wide access', async () => {
    mocks.requireCredentialAccess.mockResolvedValueOnce(undefined)

    await expect(
      resolveManagedOAuthCredentialToken.execute({ principal: executorPrincipal(), input })
    ).resolves.toEqual({ accessToken: 'access-token', refreshed: false })
    expect(mocks.resolveToken).toHaveBeenCalledOnce()
  })
})
