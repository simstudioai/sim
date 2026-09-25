import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  credentialGroupsAvailabilityMock,
  credentialGroupsAvailabilityMockFns,
} from '@sim/testing/mocks/credential-groups-availability.mock'
import {
  credentialsAccessMock,
  credentialsAccessMockFns,
} from '@sim/testing/mocks/credentials-access.mock'
import {
  resourcePolicyRepositoryMock,
  resourcePolicyRepositoryMockFns,
} from '@sim/testing/mocks/resource-policy-repository.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  context: vi.fn(),
  decrypt: vi.fn(),
  enrollment: vi.fn(),
}))
vi.mock('@/lib/credentials/application/credential-context', () => ({
  resolveCredentialApplicationContext: hoisted.context,
}))
vi.mock('@/lib/credentials/access', () => credentialsAccessMock)
vi.mock('@/lib/credentials/gitlab-personal-token', () => ({
  decryptPersonalToken: hoisted.decrypt,
}))
vi.mock('@/lib/credentials/personal-tokens', () => ({
  requirePersonalTokenEnrollment: hoisted.enrollment,
}))
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/resource-policies/repository', () => resourcePolicyRepositoryMock)
vi.mock('@/lib/credential-groups/scoped-availability', () => credentialGroupsAvailabilityMock)

import { buildOrganizationAccountAccessPolicy } from '@/lib/credential-groups/application/workspace-access-policy'
import { resolvePersonalToken } from '@/lib/credentials/application/resolve-personal-token'

const mocks = {
  ...hoisted,
  access: credentialsAccessMockFns.mockGetCredentialActorContext,
  policy: resourcePolicyRepositoryMockFns.mockRequireResourcePolicy,
  available: credentialGroupsAvailabilityMockFns.mockIsScopedCredentialGroupsAvailable,
  permission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  audit: auditMockFns.mockRecordAudit,
}

const principal = createSessionPrincipal({ userId: 'owner', sessionId: 'session' })
const input = { credentialId: 'token', assertedWorkspaceId: 'ws', expectedProviderId: 'gitlab' }
const current = {
  id: 'token',
  workspaceId: 'ws',
  type: 'personal_token',
  createdBy: 'owner',
  providerId: 'gitlab',
  providerSubjectId: '42',
  providerTenantId: 'https://gitlab.example.test',
  encryptedPersonalToken: 'ciphertext',
  credentialGroupEnrollmentId: 'enrollment',
  revokedAt: null,
  accessTokenExpiresAt: null,
}
const context = {
  workspaceId: 'ws',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  credential: current,
}
describe('authorized personal token resolution', () => {
  beforeEach(() => {
    mocks.context.mockResolvedValue(context)
    mocks.access.mockResolvedValue({
      credential: current,
      member: null,
      hasWorkspaceAccess: true,
      canWriteWorkspace: false,
      isAdmin: true,
    })
    mocks.permission.mockResolvedValue('read')
    mocks.decrypt.mockResolvedValue('secret')
    mocks.enrollment.mockResolvedValue(undefined)
  })
  it('resolves the encrypted owner-bound target and emits semantic use audit without the secret', async () => {
    await expect(resolvePersonalToken.execute({ principal, input })).resolves.toEqual({
      accessToken: 'secret',
      instanceUrl: 'https://gitlab.example.test',
      providerId: 'gitlab',
    })
    expect(mocks.decrypt).toHaveBeenCalledWith('ciphertext', {
      providerId: 'gitlab',
      ownerUserId: 'owner',
      workspaceId: 'ws',
      subjectId: '42',
      instanceUrl: 'https://gitlab.example.test',
    })
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'credential.accessed', resourceId: 'token' })
    )
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('secret')
  })
  it('denies workspace admins and forged member grants even if an adapter incorrectly marks them authorized', async () => {
    await expect(
      resolvePersonalToken.execute({ principal: { ...principal, userId: 'admin' }, input })
    ).rejects.toThrow('own active personal token')
    expect(mocks.decrypt).not.toHaveBeenCalled()
  })
  it.each([{ type: 'service_account' }, { revokedAt: new Date() }, { createdBy: 'other' }])(
    'refuses unusable or differently-owned tokens before decryption',
    async (override) => {
      mocks.context.mockResolvedValue({ ...context, credential: { ...current, ...override } })
      await expect(resolvePersonalToken.execute({ principal, input })).rejects.toThrow(
        'own active personal token'
      )
      expect(mocks.decrypt).not.toHaveBeenCalled()
    }
  )
  it('refuses revoked enrollment or disabled group before decryption after approval', async () => {
    mocks.enrollment.mockRejectedValue(new Error('Connected accounts is disabled'))
    await expect(resolvePersonalToken.execute({ principal, input })).rejects.toThrow(
      'Connected accounts'
    )
    expect(mocks.decrypt).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('authorizes organization token type before decrypting and rechecks revocation', async () => {
    const organizationToken = { ...current, workspaceId: null, organizationId: 'org' }
    mocks.context.mockResolvedValue({
      ...context,
      workspaceOrganizationId: 'org',
      credential: organizationToken,
    })
    mocks.access.mockResolvedValue({
      credential: organizationToken,
      member: null,
      hasWorkspaceAccess: true,
      canWriteWorkspace: false,
      isAdmin: true,
    })
    mocks.enrollment.mockResolvedValue({ credentialGroupId: 'group' })
    mocks.available.mockResolvedValue(true)
    mocks.policy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy('group', [
        {
          workspaceId: 'ws',
          access: { mode: 'selected', credentialTypes: ['personal_token:gitlab'] },
        },
      ]),
    })
    await expect(resolvePersonalToken.execute({ principal, input })).resolves.toMatchObject({
      accessToken: 'secret',
    })
    mocks.decrypt.mockClear()
    mocks.policy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy('group', [
        { workspaceId: 'ws', access: { mode: 'selected', credentialTypes: ['oauth:gmail'] } },
      ]),
    })
    await expect(resolvePersonalToken.execute({ principal, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(mocks.decrypt).not.toHaveBeenCalled()
  })

  it('refuses revoked workspace access before secret resolution', async () => {
    mocks.permission.mockResolvedValue(null)
    await expect(resolvePersonalToken.execute({ principal, input })).rejects.toThrow(
      'Insufficient workspace'
    )
    expect(mocks.decrypt).not.toHaveBeenCalled()
  })
})
