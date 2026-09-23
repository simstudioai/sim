/** @vitest-environment node */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { eq, inArray, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ lock: vi.fn(), encrypt: vi.fn() }))
vi.mock('@/lib/credential-groups/enrollments', () => ({
  lockCredentialGroupEnrollmentLifecycle: mocks.lock,
}))
vi.mock('@/lib/credential-groups/credentials', () => ({
  LIVE_ENROLLMENT_STATUSES: ['in_progress', 'completed'],
}))
vi.mock('@/lib/core/security/encryption', () => ({ encryptSecret: mocks.encrypt }))

import {
  deleteEnrollmentApiKey,
  listCredentialGroupApiKeyReferences,
  loadCredentialGroupApiKey,
  saveEnrollmentApiKey,
} from '@/lib/credential-groups/api-keys'

const option = { id: 'option-1', name: 'Exa API key', description: null }
const identity = {
  organizationId: 'org-1',
  credentialGroupId: 'group-1',
  enrollmentId: 'enrollment-1',
  userId: 'invitee',
  email: 'person@example.com',
  invitationTokenHash: 'token-hash',
}
const group = { id: 'group-1', organizationId: 'org-1', workspaceId: null, apiKeyOptions: [option] }
const enrollment = {
  id: identity.enrollmentId,
  userId: identity.userId,
  status: 'invited',
  revokedAt: null,
  invitationExpiresAt: new Date(Date.now() + 3600_000),
}
const secret = 'fixture-secret-only'
const metadata = { credentialId: 'key-1', optionId: option.id, email: identity.email }

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.encrypt.mockResolvedValue({ encrypted: 'fixture-ciphertext' })
})

function queueEnrollment(overrides = {}) {
  queueTableRows(schemaMock.credentialGroup, [group])
  queueTableRows(schemaMock.credentialGroupEnrollment, [{ ...enrollment, ...overrides }])
}

describe('API key enrollment storage', () => {
  it('stores only ciphertext for the verified invitee and returns metadata', async () => {
    queueEnrollment()
    queueTableRows(schemaMock.credential, [])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'key-1' }])
    const saved = await saveEnrollmentApiKey(identity, option.id, secret)
    expect(mocks.encrypt).toHaveBeenCalledWith(secret)
    expect(mocks.lock).toHaveBeenCalledWith(expect.anything(), identity.enrollmentId)
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'managed_api_key',
        createdBy: 'invitee',
        encryptedApiKey: 'fixture-ciphertext',
        credentialGroupOptionId: option.id,
        credentialGroupEnrollmentId: identity.enrollmentId,
      })
    )
    expect(JSON.stringify(dbChainMockFns.values.mock.calls)).not.toContain(secret)
    expect(saved).toEqual({
      credentialId: 'key-1',
      optionId: option.id,
      name: option.name,
      created: true,
      enrollmentStatus: 'in_progress',
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'in_progress' })
    )
  })

  it('rotates the existing value without changing its credential ID or completed status', async () => {
    queueEnrollment({ status: 'completed' })
    queueTableRows(schemaMock.credential, [{ id: 'key-1' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'key-1' }])
    const saved = await saveEnrollmentApiKey(identity, option.id, secret)
    expect(saved).toMatchObject({
      credentialId: 'key-1',
      created: false,
      enrollmentStatus: 'completed',
    })
    expect(dbChainMockFns.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: [
          schemaMock.credential.credentialGroupEnrollmentId,
          schemaMock.credential.credentialGroupOptionId,
        ],
        set: expect.objectContaining({ encryptedApiKey: 'fixture-ciphertext', revokedAt: null }),
      })
    )
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })

  it.each([
    { userId: 'other-user' },
    { status: 'revoked' },
    { status: 'delivery_failed' },
    { revokedAt: new Date() },
    { invitationExpiresAt: new Date(0) },
  ])('refuses a stale or foreign enrollment %j', async (overrides) => {
    queueEnrollment(overrides)
    await expect(saveEnrollmentApiKey(identity, option.id, secret)).rejects.toThrow(
      'invalid or expired'
    )
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('rejects a removed definition before storing or deleting anything', async () => {
    queueTableRows(schemaMock.credentialGroup, [{ ...group, apiKeyOptions: [] }])
    await expect(saveEnrollmentApiKey(identity, option.id, secret)).rejects.toThrow(
      'no longer available'
    )
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('scopes disconnect to the current enrollment, option, and contributor', async () => {
    queueEnrollment()
    await deleteEnrollmentApiKey(identity, option.id)
    expect(eq).toHaveBeenCalledWith(schemaMock.credential.createdBy, identity.userId)
    expect(eq).toHaveBeenCalledWith(
      schemaMock.credential.credentialGroupEnrollmentId,
      identity.enrollmentId
    )
    expect(eq).toHaveBeenCalledWith(schemaMock.credential.credentialGroupOptionId, option.id)
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(schemaMock.credential)
  })

  it.each(['short', ' fixture-secret ', 'x'.repeat(4097)])(
    'rejects an invalid value before encryption',
    async (value) => {
      await expect(saveEnrollmentApiKey(identity, option.id, value)).rejects.toMatchObject({
        code: 'validation',
      })
      expect(mocks.encrypt).not.toHaveBeenCalled()
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    }
  )
})

describe('API key runtime reads', () => {
  it('lists metadata with a bounded page and no encrypted or plaintext values', async () => {
    queueTableRows(schemaMock.credentialGroup, [{ options: [option] }])
    queueTableRows(schemaMock.credential, [metadata, { ...metadata, credentialId: 'key-2' }])
    const result = await listCredentialGroupApiKeyReferences(identity, {
      limit: 1,
      keyName: 'EXA API KEY',
      email: identity.email,
    })
    expect(result).toEqual({
      apiKeys: [{ ...metadata, name: option.name }],
      count: 1,
      hasMore: true,
      nextCursor: 'key-1',
    })
    expect(dbChainMockFns.limit).toHaveBeenLastCalledWith(2)
    expect(dbChainMockFns.select).toHaveBeenLastCalledWith({
      credentialId: schemaMock.credential.id,
      optionId: schemaMock.credential.credentialGroupOptionId,
      email: schemaMock.credentialGroupEnrollment.email,
    })
    expect(eq).toHaveBeenCalledWith(schemaMock.credential.organizationId, identity.organizationId)
    expect(eq).toHaveBeenCalledWith(schemaMock.credentialGroup.id, identity.credentialGroupId)
    expect(eq).toHaveBeenCalledWith(
      schemaMock.credential.createdBy,
      schemaMock.credentialGroupEnrollment.userId
    )
    expect(inArray).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment.status, [
      'in_progress',
      'completed',
    ])
    expect(isNull).toHaveBeenCalledWith(schemaMock.credential.revokedAt)
    expect(isNull).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment.revokedAt)
  })

  it('fails instead of returning unrelated keys for an unknown name', async () => {
    queueTableRows(schemaMock.credentialGroup, [{ options: [option] }])
    await expect(
      listCredentialGroupApiKeyReferences(identity, { limit: 10, keyName: 'Missing' })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(dbChainMockFns.from).not.toHaveBeenCalledWith(schemaMock.credential)
  })

  it.each([{ rows: [] }, { rows: [{ ...metadata, options: [], encryptedValue: 'ciphertext' }] }])(
    'rejects missing, removed, or out-of-scope credentials',
    async ({ rows }) => {
      queueTableRows(schemaMock.credential, rows)
      await expect(loadCredentialGroupApiKey(identity, 'key-1')).rejects.toMatchObject({
        code: 'not_found',
      })
    }
  )
})
