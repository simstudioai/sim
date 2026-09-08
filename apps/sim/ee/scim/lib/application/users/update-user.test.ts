/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { type ScimUserAttributes, scimConnection } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  acquireLocks: vi.fn(),
  suspend: vi.fn(),
  unsuspend: vi.fn(),
  revokeSessions: vi.fn(),
  invalidate: vi.fn(),
  syncIdentity: vi.fn(),
  assertDomainOwned: vi.fn(),
  reconcile: vi.fn(),
  findScimUserById: vi.fn(),
  assertUserNameAvailable: vi.fn(),
  updateScimUser: vi.fn(),
  loadGroups: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationUserMutationLocks: mocks.acquireLocks,
}))
vi.mock('@/lib/organizations/members/lifecycle', () => ({
  suspendMemberTx: mocks.suspend,
  unsuspendMemberTx: mocks.unsuspend,
}))
vi.mock('@/lib/organizations/members/revocation', () => ({
  revokeUserSessionsTx: mocks.revokeSessions,
  invalidateAfterSessionRevocation: mocks.invalidate,
}))
vi.mock('@/ee/scim/lib/identity/account-identity', () => ({
  syncAccountIdentityTx: mocks.syncIdentity,
}))
vi.mock('@/ee/scim/lib/identity/resolve-user', () => ({
  assertDomainOwned: mocks.assertDomainOwned,
}))
vi.mock('@/ee/scim/lib/projection/reconcile-user', () => ({
  reconcileUserProjection: mocks.reconcile,
}))
vi.mock('@/ee/scim/lib/repository/users', () => ({
  findScimUserById: mocks.findScimUserById,
  assertUserNameAvailable: mocks.assertUserNameAvailable,
  updateScimUser: mocks.updateScimUser,
  loadGroupsForScimUsers: mocks.loadGroups,
  toUserResourceRow: (record: Record<string, unknown>) => ({
    id: record.id,
    externalId: record.externalId,
    userName: record.userName,
    active: record.active,
    attributes: record.attributes,
    email: record.email,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    groups: [],
  }),
}))
vi.mock('@/ee/scim/lib/application/audit', () => ({
  recordScimAuditEntries: mocks.recordAudit,
}))
vi.mock('@/ee/scim/lib/base-url', () => ({ scimBaseUrl: () => 'https://sim.test/api/scim/v2' }))

import type { Principal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { patchScimUser, replaceScimUser } from '@/ee/scim/lib/application/users/update-user'

const principal: Principal = {
  kind: 'scim_connection',
  organizationId: 'org-1',
  connectionId: 'conn-1',
  credentialId: 'cred-1',
  scopes: ['users:write'],
}

function attributes(overrides: Partial<ScimUserAttributes> = {}): ScimUserAttributes {
  return {
    userName: 'ada@acme.test',
    externalId: 'ext-1',
    active: true,
    displayName: 'Ada Lovelace',
    displayNameSource: 'provider',
    name: { formatted: 'Ada Lovelace', givenName: 'Ada', familyName: 'Lovelace' },
    emails: [{ value: 'ada@acme.test', type: 'work', primary: true }],
    ...overrides,
  }
}

function stage(
  record: {
    attributes?: Partial<ScimUserAttributes>
    email?: string
    name?: string
    active?: boolean
  } = {}
) {
  queueTableRows(scimConnection, [
    { id: 'conn-1', organizationId: 'org-1', status: 'active', settings: {} },
  ])
  const stored = attributes(record.attributes)
  mocks.findScimUserById.mockResolvedValue({
    id: 'su-1',
    userId: 'u-1',
    externalId: stored.externalId ?? null,
    userName: stored.userName,
    active: record.active ?? stored.active,
    attributes: stored,
    email: record.email ?? 'ada@acme.test',
    name:
      record.name ??
      (stored.displayNameSource === 'provider' ? stored.displayName : undefined) ??
      stored.name.formatted,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    userSuspendedAt: null,
  })
}

const run = (
  useCase: typeof replaceScimUser | typeof patchScimUser,
  input: Record<string, unknown>
) => useCase.execute({ principal, input: input as never, request: undefined })

afterAll(resetDbChainMock)

describe('user updates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.loadGroups.mockResolvedValue(new Map())
    mocks.reconcile.mockResolvedValue({ added: [], removed: [], raised: [] })
  })

  it('serializes on the organization and user locks before computing the update', async () => {
    stage()
    await run(patchScimUser, {
      scimUserId: 'su-1',
      operations: [{ op: 'replace', path: 'displayName', value: 'Augusta' }],
    })
    expect(mocks.acquireLocks).toHaveBeenCalledWith(db, {
      userId: 'u-1',
      organizationIds: ['org-1'],
    })
    expect(mocks.findScimUserById).toHaveBeenCalledTimes(3)
    expect(mocks.acquireLocks.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.findScimUserById.mock.invocationCallOrder[1]
    )
  })

  it('writes and audits nothing when Okta re-sends the stored resource', async () => {
    stage()
    const result = await run(replaceScimUser, { scimUserId: 'su-1', attributes: attributes() })
    expect(result.outcome).toBeNull()
    expect(mocks.updateScimUser).not.toHaveBeenCalled()
    expect(mocks.syncIdentity).not.toHaveBeenCalled()
    expect(mocks.reconcile).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
    expect(result.resource.id).toBe('su-1')
  })

  it('projects an Okta display-name update despite an echoed stale formatted name', async () => {
    stage()
    const next = attributes({
      displayName: 'Augusta King',
      name: { formatted: 'Ada Lovelace', givenName: 'Augusta', familyName: 'King' },
    })
    await run(replaceScimUser, { scimUserId: 'su-1', attributes: next })
    expect(mocks.syncIdentity).toHaveBeenCalledWith(db, { userId: 'u-1', name: 'Augusta King' })
    expect(mocks.updateScimUser).toHaveBeenCalledWith(db, {
      scimUserId: 'su-1',
      attributes: next,
      active: true,
    })
    expect(mocks.assertDomainOwned).not.toHaveBeenCalled()
    expect(mocks.revokeSessions).not.toHaveBeenCalled()
    expect(mocks.suspend).not.toHaveBeenCalled()
    expect(mocks.unsuspend).not.toHaveBeenCalled()
    expect(mocks.invalidate).not.toHaveBeenCalled()
  })

  it.each(['patch', 'replace'] as const)(
    'repairs account-name drift on an identical %s only once',
    async (method) => {
      const useCase = method === 'patch' ? patchScimUser : replaceScimUser
      const input =
        method === 'patch'
          ? {
              scimUserId: 'su-1',
              operations: [{ op: 'replace', path: 'displayName', value: 'Ada Lovelace' }],
            }
          : { scimUserId: 'su-1', attributes: attributes() }
      stage({ name: 'Old account name' })
      const repaired = await run(useCase, input)
      expect(repaired.outcome).not.toBeNull()
      expect(mocks.syncIdentity).toHaveBeenCalledWith(db, { userId: 'u-1', name: 'Ada Lovelace' })
      expect(mocks.revokeSessions).not.toHaveBeenCalled()
      expect(mocks.invalidate).not.toHaveBeenCalled()

      vi.clearAllMocks()
      stage()
      const repeated = await run(useCase, input)
      expect(repeated.outcome).toBeNull()
      expect(mocks.syncIdentity).not.toHaveBeenCalled()
      expect(mocks.updateScimUser).not.toHaveBeenCalled()
      expect(mocks.reconcile).not.toHaveBeenCalled()
      expect(mocks.recordAudit).not.toHaveBeenCalled()
    }
  )

  it.each(['add', 'replace'] as const)('projects a display-name-only PATCH %s', async (op) => {
    stage()
    await run(patchScimUser, {
      scimUserId: 'su-1',
      operations: [{ op, path: 'displayName', value: 'Countess Lovelace' }],
    })
    expect(mocks.syncIdentity).toHaveBeenCalledWith(db, {
      userId: 'u-1',
      name: 'Countess Lovelace',
    })
  })

  it('updates the account from name parts when no explicit display name exists', async () => {
    stage({ attributes: { displayName: undefined } })
    await run(patchScimUser, {
      scimUserId: 'su-1',
      operations: [{ op: 'replace', path: 'name.givenName', value: 'Augusta' }],
    })
    expect(mocks.syncIdentity).toHaveBeenCalledWith(db, { userId: 'u-1', name: 'Augusta Lovelace' })
    expect(mocks.updateScimUser.mock.calls[0][1].attributes.displayName).toBeUndefined()
  })

  it('keeps an explicit display name when only a name part changes', async () => {
    stage()
    await run(patchScimUser, {
      scimUserId: 'su-1',
      operations: [{ op: 'replace', path: 'name.givenName', value: 'Augusta' }],
    })
    expect(mocks.syncIdentity).not.toHaveBeenCalled()
    expect(mocks.updateScimUser.mock.calls[0][1].attributes.name.formatted).toBe('Augusta Lovelace')
  })

  it('preserves name-part updates for legacy records with synthesized display names', async () => {
    stage({ attributes: { displayNameSource: undefined } })
    await run(patchScimUser, {
      scimUserId: 'su-1',
      operations: [{ op: 'replace', path: 'name.givenName', value: 'Augusta' }],
    })
    expect(mocks.syncIdentity).toHaveBeenCalledWith(db, { userId: 'u-1', name: 'Augusta Lovelace' })
  })

  it('adopts an explicit display name when a provider replaces a legacy profile', async () => {
    stage({ attributes: { displayName: 'Countess Lovelace', displayNameSource: undefined } })
    await run(replaceScimUser, {
      scimUserId: 'su-1',
      attributes: attributes({ displayName: 'Countess Lovelace' }),
    })
    expect(mocks.syncIdentity).toHaveBeenCalledWith(db, {
      userId: 'u-1',
      name: 'Countess Lovelace',
    })
    expect(mocks.updateScimUser.mock.calls[0][1].attributes.displayNameSource).toBe('provider')
  })

  it('restores the formatted fallback when a display name is removed', async () => {
    stage({ attributes: { displayName: 'Countess Lovelace' } })
    await run(patchScimUser, {
      scimUserId: 'su-1',
      operations: [{ op: 'remove', path: 'displayName' }],
    })
    expect(mocks.syncIdentity).toHaveBeenCalledWith(db, { userId: 'u-1', name: 'Ada Lovelace' })
    expect(mocks.updateScimUser.mock.calls[0][1].attributes.displayName).toBeUndefined()
  })

  it('deactivates by suspending, never by removing, and keeps the projection', async () => {
    stage()
    const result = await run(patchScimUser, {
      scimUserId: 'su-1',
      operations: [{ op: 'replace', value: { active: false } }],
    })
    expect(mocks.suspend).toHaveBeenCalledWith(db, {
      userId: 'u-1',
      organizationId: 'org-1',
      source: 'scim',
    })
    expect(mocks.revokeSessions).not.toHaveBeenCalled()
    expect(mocks.reconcile).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ scimUserId: 'su-1' })
    )
    expect(result.outcome).toEqual({ emailChanged: false, deactivated: true, reactivated: false })
    const actions = mocks.recordAudit.mock.calls[0][0].entries.map(
      (entry: { action: string }) => entry.action
    )
    expect(actions).toEqual(['scim_user.updated', 'scim_user.deactivated'])
    expect(mocks.invalidate).toHaveBeenCalledWith({ userId: 'u-1', organizationId: 'org-1' })
  })

  it.each(['patch', 'replace'] as const)(
    'propagates owner protection through %s',
    async (method) => {
      stage()
      mocks.suspend.mockRejectedValueOnce(
        new OrchestrationError('conflict', 'Transfer ownership first')
      )
      const useCase = method === 'patch' ? patchScimUser : replaceScimUser
      const input =
        method === 'patch'
          ? { scimUserId: 'su-1', operations: [{ op: 'replace', path: 'active', value: false }] }
          : { scimUserId: 'su-1', attributes: attributes({ active: false }) }
      await expect(run(useCase, input)).rejects.toMatchObject({ code: 'conflict' })
      expect(mocks.updateScimUser).not.toHaveBeenCalled()
      expect(mocks.reconcile).not.toHaveBeenCalled()
      expect(mocks.recordAudit).not.toHaveBeenCalled()
    }
  )

  it('proves the organization owns the new domain before moving the address, then signs the user out', async () => {
    stage()
    await run(patchScimUser, {
      scimUserId: 'su-1',
      operations: [{ op: 'replace', path: 'emails[type eq "work"].value', value: 'ada@corp.test' }],
    })
    expect(mocks.assertDomainOwned).toHaveBeenCalledWith(db, 'org-1', 'ada@corp.test')
    expect(mocks.assertDomainOwned.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.syncIdentity.mock.invocationCallOrder[0]
    )
    expect(mocks.syncIdentity).toHaveBeenCalledWith(db, {
      userId: 'u-1',
      email: 'ada@corp.test',
      name: 'Ada Lovelace',
    })
    expect(mocks.revokeSessions).toHaveBeenCalled()
  })

  it('re-asserts the directory address when the account drifted away from it', async () => {
    stage({ email: 'changed-in-sim@acme.test' })
    const result = await run(replaceScimUser, { scimUserId: 'su-1', attributes: attributes() })
    expect(result.outcome?.emailChanged).toBe(true)
    expect(mocks.syncIdentity).toHaveBeenCalledWith(db, {
      userId: 'u-1',
      email: 'ada@acme.test',
      name: 'Ada Lovelace',
    })
  })

  it('refuses a credential without the write scope', async () => {
    stage()
    const error = await replaceScimUser
      .execute({
        principal: { ...principal, scopes: ['users:read'] },
        input: { scimUserId: 'su-1', attributes: attributes() },
        request: undefined,
      })
      .catch((caught) => caught)
    expect(error.status).toBe(403)
    expect(mocks.findScimUserById).not.toHaveBeenCalled()
  })
})
