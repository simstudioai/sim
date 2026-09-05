/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  access: vi.fn(),
  permission: vi.fn(),
  decrypt: vi.fn(),
  audit: vi.fn(),
  enrollment: vi.fn(),
}))
vi.mock('@/lib/credentials/application/credential-context', () => ({
  resolveCredentialApplicationContext: mocks.context,
}))
vi.mock('@/lib/credentials/access', () => ({ getCredentialActorContext: mocks.access }))
vi.mock('@/lib/credentials/gitlab-personal-token', () => ({ decryptPersonalToken: mocks.decrypt }))
vi.mock('@/lib/credentials/personal-tokens', () => ({
  requirePersonalTokenEnrollment: mocks.enrollment,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (p: string | null) => p !== null,
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@sim/audit', () => ({
  AuditAction: { CREDENTIAL_ACCESSED: 'credential.accessed' },
  AuditResourceType: { CREDENTIAL: 'credential' },
  recordAudit: mocks.audit,
}))

import { resolvePersonalToken } from '@/lib/credentials/application/resolve-personal-token'

const principal = { kind: 'session', userId: 'owner', sessionId: 'session' } as const
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
    vi.clearAllMocks()
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
    expect(mocks.context).toHaveBeenCalledWith(input)
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
  it.each([
    { type: 'service_account' },
    { providerId: 'other' },
    { revokedAt: new Date() },
    { accessTokenExpiresAt: new Date(0) },
    { createdBy: 'other' },
  ])('refuses unusable or differently-owned tokens before decryption', async (override) => {
    mocks.context.mockResolvedValue({ ...context, credential: { ...current, ...override } })
    await expect(resolvePersonalToken.execute({ principal, input })).rejects.toThrow(
      'own active personal token'
    )
    expect(mocks.decrypt).not.toHaveBeenCalled()
  })
  it('refuses revoked enrollment or disabled group before decryption after approval', async () => {
    mocks.enrollment.mockRejectedValue(new Error('Connected accounts is disabled'))
    await expect(resolvePersonalToken.execute({ principal, input })).rejects.toThrow(
      'Connected accounts'
    )
    expect(mocks.enrollment).toHaveBeenCalledWith({
      workspaceId: 'ws',
      userId: 'owner',
      enrollmentId: 'enrollment',
    })
    expect(mocks.decrypt).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('refuses revoked workspace access before secret resolution', async () => {
    mocks.permission.mockResolvedValue(null)
    await expect(resolvePersonalToken.execute({ principal, input })).rejects.toThrow(
      'Insufficient workspace'
    )
    expect(mocks.decrypt).not.toHaveBeenCalled()
  })
})
