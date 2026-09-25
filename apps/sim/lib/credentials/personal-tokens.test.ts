import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import {
  credentialGroupsEnrollmentsMock,
  credentialGroupsEnrollmentsMockFns,
} from '@sim/testing/mocks/credential-groups-enrollments.mock'
import {
  credentialGroupsOrganizationSetupMock,
  credentialGroupsOrganizationSetupMockFns,
} from '@sim/testing/mocks/credential-groups-organization-setup.mock'
import {
  credentialGroupsSelfEnrollmentMock,
  credentialGroupsSelfEnrollmentMockFns,
} from '@sim/testing/mocks/credential-groups-self-enrollment.mock'
import { eq, inArray, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  verify: vi.fn(),
  encrypt: vi.fn(),
}))
vi.mock('@/lib/credential-groups/organization-setup', () => credentialGroupsOrganizationSetupMock)
vi.mock('@/lib/credential-groups/self-enrollment', () => credentialGroupsSelfEnrollmentMock)
vi.mock('@/lib/credential-groups/enrollments', () => credentialGroupsEnrollmentsMock)
vi.mock('@/lib/credentials/gitlab-personal-token', () => ({
  verifyGitLabPersonalToken: hoisted.verify,
  encryptPersonalToken: hoisted.encrypt,
}))

import {
  createPersonalTokenCredential,
  getPersonalTokenCredentials,
  requirePersonalTokenEnrollment,
  updatePersonalTokenCredential,
} from '@/lib/credentials/personal-tokens'
import type { CredentialRow } from '@/lib/credentials/queries'

const mocks = {
  ...hoisted,
  setup: credentialGroupsOrganizationSetupMockFns.mockRequireOrganizationAccountsSetup,
  enroll: credentialGroupsSelfEnrollmentMockFns.mockCreateViewerCredentialGroupEnrollment,
  lock: credentialGroupsEnrollmentsMockFns.mockLockCredentialGroupEnrollmentLifecycle,
}

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
    resetDbChainMock()
    mocks.setup.mockResolvedValue(undefined)
    mocks.enroll.mockResolvedValue({ enrollment: { id: 'enrollment' }, invitationLink: 'unused' })
    mocks.verify.mockResolvedValue(verified)
    mocks.encrypt.mockResolvedValue('ciphertext')
  })
  it('automatically saves a verified token into the canonical group enrollment', async () => {
    binding()
    dbChainMockFns.returning.mockResolvedValueOnce([current])
    const result = await createPersonalTokenCredential(input)
    expect(result.created).toBe(true)
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
