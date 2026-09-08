/** @vitest-environment node */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { eq, inArray, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setup: vi.fn(),
  enroll: vi.fn(),
  verify: vi.fn(),
  encrypt: vi.fn(),
  lock: vi.fn(),
}))
vi.mock('@/lib/credential-groups/organization-setup', () => ({
  requireOrganizationAccountsSetup: mocks.setup,
}))
vi.mock('@/lib/credential-groups/self-enrollment', () => ({
  createViewerCredentialGroupEnrollment: mocks.enroll,
}))
vi.mock('@/lib/credential-groups/enrollments', () => ({
  lockCredentialGroupEnrollmentLifecycle: mocks.lock,
}))
vi.mock('@/lib/credentials/gitlab-personal-token', () => ({
  verifyGitLabPersonalToken: mocks.verify,
  encryptPersonalToken: mocks.encrypt,
}))

import {
  createPersonalTokenCredential,
  getPersonalTokenCredentials,
  requirePersonalTokenEnrollment,
  updatePersonalTokenCredential,
} from '@/lib/credentials/personal-tokens'
import type { CredentialRow } from '@/lib/credentials/queries'

const input = {
  userId: 'owner',
  accounts: { organizationId: 'organization', credentialGroupId: 'group' },
  providerId: 'gitlab',
  apiToken: 'personal-secret',
  domain: 'gitlab.example.test',
}
const verified = {
  providerId: 'gitlab',
  subjectId: '42',
  instanceUrl: 'https://gitlab.example.test',
  displayName: 'Personal GitLab',
  grantedScopes: ['api'],
  expiresAt: null,
}
const current = {
  id: 'token',
  workspaceId: null,
  organizationId: 'organization',
  createdBy: 'owner',
  type: 'personal_token',
  providerId: 'gitlab',
  providerSubjectId: '42',
  providerTenantId: 'https://gitlab.example.test',
  credentialGroupEnrollmentId: 'enrollment',
} as CredentialRow
function binding(organizationId: string | null = 'organization') {
  queueTableRows(schemaMock.credentialGroupEnrollment, [
    {
      id: 'enrollment',
      credentialGroupId: 'group',
      organizationId,
      workspaceOrganizationId: 'organization',
    },
  ])
}
function expectLiveBinding() {
  expect(eq).toHaveBeenCalledWith(schemaMock.credentialGroup.status, 'active')
  expect(eq).toHaveBeenCalledWith(schemaMock.user.id, 'owner')
  expect(eq).toHaveBeenCalledWith(schemaMock.user.emailVerified, true)
  expect(eq).toHaveBeenCalledWith(schemaMock.user.id, schemaMock.credentialGroupEnrollment.userId)
  expect(inArray).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment.status, [
    'invited',
    'in_progress',
    'completed',
  ])
  expect(isNull).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment.revokedAt)
}

describe('personal GitLab tokens in Connected accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.setup.mockResolvedValue(undefined)
    mocks.enroll.mockResolvedValue({ enrollment: { id: 'enrollment' }, invitationLink: 'unused' })
    mocks.verify.mockResolvedValue(verified)
    mocks.encrypt.mockResolvedValue('ciphertext')
  })
  it('bounds a reconnect lookup by credential ID without weakening enrollment checks', async () => {
    await getPersonalTokenCredentials('workspace', 'owner', 'token')
    expect(eq).toHaveBeenCalledWith(schemaMock.credential.id, 'token')
    expect(eq).toHaveBeenCalledWith(schemaMock.credential.createdBy, 'owner')
    expect(eq).toHaveBeenCalledWith(schemaMock.credential.workspaceId, 'workspace')
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1)
    expectLiveBinding()
  })
  it('automatically saves a verified token into the canonical group enrollment', async () => {
    binding()
    dbChainMockFns.returning.mockResolvedValueOnce([current])
    const result = await createPersonalTokenCredential(input)
    expect(result.created).toBe(true)
    expect(mocks.enroll).toHaveBeenCalledWith({
      organizationId: 'organization',
      userId: 'owner',
      credentialGroupId: 'group',
    })
    expect(mocks.lock).toHaveBeenCalledWith(expect.anything(), 'enrollment')
    expect(dbChainMockFns.for).toHaveBeenCalledWith('share', expect.anything())
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialGroupEnrollmentId: 'enrollment',
        workspaceId: null,
        organizationId: 'organization',
        createdBy: 'owner',
        providerSubjectId: '42',
        providerTenantId: verified.instanceUrl,
        encryptedPersonalToken: 'ciphertext',
      })
    )
    expect(mocks.setup).toHaveBeenCalledWith('organization', 'group', expect.anything())
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'in_progress' })
    )
    expectLiveBinding()
  })
  it('reconnects the same identity slot without creating a second personal credential', async () => {
    binding()
    dbChainMockFns.returning.mockResolvedValueOnce([]).mockResolvedValueOnce([current])
    const result = await createPersonalTokenCredential(input)
    expect(result.created).toBe(false)
    expect(dbChainMockFns.onConflictDoNothing).toHaveBeenCalledWith(
      expect.objectContaining({
        target: [
          schemaMock.credential.organizationId,
          schemaMock.credential.createdBy,
          schemaMock.credential.providerId,
          schemaMock.credential.providerTenantId,
          schemaMock.credential.providerSubjectId,
        ],
      })
    )
    expect(dbChainMockFns.set).toHaveBeenLastCalledWith(
      expect.objectContaining({
        credentialGroupEnrollmentId: 'enrollment',
        encryptedPersonalToken: 'ciphertext',
      })
    )
  })
  it('does not persist a token when enrollment was revoked while the provider was being verified', async () => {
    await expect(createPersonalTokenCredential(input)).rejects.toThrow('no longer available')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expectLiveBinding()
  })
  it('refuses missing organization account setup before persisting the token', async () => {
    binding()
    mocks.setup.mockRejectedValueOnce(new Error('Organization setup unavailable'))
    await expect(createPersonalTokenCredential(input)).rejects.toThrow(
      'Organization setup unavailable'
    )
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('preserves existing workspace enrollments during the organization cutover', async () => {
    binding(null)
    await requirePersonalTokenEnrollment({
      workspaceId: 'workspace',
      userId: 'owner',
      enrollmentId: 'enrollment',
    })
    expect(mocks.setup).not.toHaveBeenCalled()
    expectLiveBinding()
  })

  it('rechecks organization account setup before rotating a personal token', async () => {
    binding()
    mocks.setup.mockRejectedValueOnce(new Error('Organization setup unavailable'))
    await expect(
      updatePersonalTokenCredential({ credential: current, apiToken: 'rotated' })
    ).rejects.toThrow('Organization setup unavailable')
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
  it('lists only the verified owner’s currently usable enrollment and includes its update time', async () => {
    const updatedAt = new Date('2026-09-01T00:00:00Z')
    queueTableRows(schemaMock.credential, [
      {
        id: 'token',
        providerId: 'gitlab',
        displayName: 'GitLab',
        instanceUrl: verified.instanceUrl,
        updatedAt,
        connectedAt: updatedAt,
      },
    ])
    expect(await getPersonalTokenCredentials('workspace', 'owner')).toEqual([
      {
        id: 'token',
        providerId: 'gitlab',
        displayName: 'GitLab',
        instanceUrl: verified.instanceUrl,
        updatedAt,
        connectedAt: updatedAt,
        type: 'personal_token',
      },
    ])
    expectLiveBinding()
    expect(dbChainMockFns.select).toHaveBeenCalledWith(
      expect.objectContaining({ updatedAt: schemaMock.credential.updatedAt })
    )
    expect(eq).toHaveBeenCalledWith(schemaMock.credential.createdBy, 'owner')
    expect(isNull).toHaveBeenCalledWith(schemaMock.credential.revokedAt)
  })
  it('fails closed for old unbound tokens and missing live enrollment matches', async () => {
    await expect(
      requirePersonalTokenEnrollment({
        workspaceId: 'workspace',
        userId: 'owner',
        enrollmentId: null,
      })
    ).rejects.toThrow('Reconnect')
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    await expect(
      requirePersonalTokenEnrollment({
        workspaceId: 'workspace',
        userId: 'owner',
        enrollmentId: 'enrollment',
      })
    ).rejects.toThrow('no longer available')
    expectLiveBinding()
  })
  it('keeps the owner, instance, subject and enrollment when rotating', async () => {
    binding()
    binding()
    dbChainMockFns.returning.mockResolvedValueOnce([current])
    expect(
      await updatePersonalTokenCredential({ credential: current, apiToken: 'rotated-secret' })
    ).toMatchObject({ success: true, updatedFields: ['apiToken'] })
    expect(mocks.verify).toHaveBeenCalledWith('rotated-secret', verified.instanceUrl)
    expect(mocks.encrypt).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: 'owner',
        organizationId: 'organization',
        subjectId: '42',
        instanceUrl: verified.instanceUrl,
      })
    )
    const update = dbChainMockFns.set.mock.calls[0][0]
    expect(update).toHaveProperty('grantedAt')
    expect(update).not.toHaveProperty('createdBy')
    expect(update).not.toHaveProperty('providerSubjectId')
    expect(update).not.toHaveProperty('providerTenantId')
    expect(update).not.toHaveProperty('credentialGroupEnrollmentId')
    expect(eq).toHaveBeenCalledWith(schemaMock.credential.organizationId, 'organization')
    expect(eq).toHaveBeenCalledWith(schemaMock.credential.providerSubjectId, '42')
    expectLiveBinding()
  })
  it('does not signal a new connection for metadata-only edits', async () => {
    binding()
    binding()
    dbChainMockFns.returning.mockResolvedValueOnce([current])
    await updatePersonalTokenCredential({ credential: current, displayName: 'Renamed account' })
    expect(dbChainMockFns.set.mock.calls[0][0]).not.toHaveProperty('grantedAt')
    expect(mocks.verify).not.toHaveBeenCalled()
  })
  it('refuses a revoked enrollment before verifying a replacement token', async () => {
    await expect(
      updatePersonalTokenCredential({ credential: current, apiToken: 'rotated-secret' })
    ).rejects.toThrow('no longer available')
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
  it('rechecks revocation after provider verification before writing the rotation', async () => {
    binding()
    await expect(
      updatePersonalTokenCredential({ credential: current, apiToken: 'rotated-secret' })
    ).rejects.toThrow('no longer available')
    expect(mocks.verify).toHaveBeenCalledOnce()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
  it.each([{ subjectId: 'other' }, { instanceUrl: 'https://other.example.test' }])(
    'refuses provider identity changes on rotation',
    async (change) => {
      binding()
      mocks.verify.mockResolvedValue({ ...verified, ...change })
      await expect(
        updatePersonalTokenCredential({ credential: current, apiToken: 'rotated-secret' })
      ).rejects.toThrow('same GitLab account')
      expect(mocks.encrypt).not.toHaveBeenCalled()
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    }
  )
})
