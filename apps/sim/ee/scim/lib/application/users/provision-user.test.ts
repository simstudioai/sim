import { db } from '@sim/db'
import { type ScimUserAttributes, scimConnection } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createUser: vi.fn(),
  applySessionPolicy: vi.fn(),
  syncUsageLimits: vi.fn(),
  ensureMember: vi.fn(),
  resolveSeatPolicy: vi.fn(),
  reconcileSeats: vi.fn(),
  isInstanceMode: vi.fn(),
  getInstanceOrganizationId: vi.fn(),
  suspend: vi.fn(),
  unsuspend: vi.fn(),
  invalidate: vi.fn(),
  revokeSessions: vi.fn(),
  captureEvent: vi.fn(),
  deleteAccount: vi.fn(),
  syncIdentity: vi.fn(),
  assertEmailAvailable: vi.fn(),
  consumeTombstone: vi.fn(),
  resolveIdentity: vi.fn(),
  reconcile: vi.fn(),
  assertUserNameAvailable: vi.fn(),
  findScimUserById: vi.fn(),
  findScimUserByUserId: vi.fn(),
  insertScimUser: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
  auth: { api: { getSession: vi.fn(), createUser: mocks.createUser } },
}))
vi.mock('@/lib/auth/session-policy', () => ({
  applySessionPolicyToNewMember: mocks.applySessionPolicy,
}))
vi.mock('@/lib/billing/core/usage', () => ({
  syncUsageLimitsFromSubscription: mocks.syncUsageLimits,
}))
vi.mock('@/lib/billing/organizations/membership', () => ({
  ensureUserInOrganizationTx: mocks.ensureMember,
}))
vi.mock('@/lib/billing/organizations/seat-policy', () => ({
  resolveOrganizationSeatPolicyTx: mocks.resolveSeatPolicy,
}))
vi.mock('@/lib/billing/organizations/seats', () => ({
  reconcileOrganizationSeats: mocks.reconcileSeats,
}))
vi.mock('@/lib/organizations/instance-org', () => ({
  isInstanceOrganizationMode: mocks.isInstanceMode,
  getInstanceOrganizationId: mocks.getInstanceOrganizationId,
}))
vi.mock('@/lib/organizations/members/lifecycle', () => ({
  suspendMemberTx: mocks.suspend,
  unsuspendMemberTx: mocks.unsuspend,
}))
vi.mock('@/lib/organizations/members/revocation', () => ({
  invalidateAfterSessionRevocation: mocks.invalidate,
  revokeUserSessionsTx: mocks.revokeSessions,
}))
vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: mocks.captureEvent,
}))
vi.mock('@/lib/users/account-deletion', () => ({
  deleteUserAccount: mocks.deleteAccount,
}))
vi.mock('@/ee/scim/lib/identity/account-identity', () => ({
  syncAccountIdentityTx: mocks.syncIdentity,
}))
vi.mock('@/ee/scim/lib/identity/resolve-user', () => ({
  assertEmailAvailable: mocks.assertEmailAvailable,
  consumeTombstone: mocks.consumeTombstone,
  resolveProvisionedIdentity: mocks.resolveIdentity,
}))
vi.mock('@/ee/scim/lib/projection/reconcile-user', () => ({
  reconcileUserProjection: mocks.reconcile,
}))
vi.mock('@/ee/scim/lib/repository/users', () => ({
  assertUserNameAvailable: mocks.assertUserNameAvailable,
  findScimUserById: mocks.findScimUserById,
  findScimUserByUserId: mocks.findScimUserByUserId,
  insertScimUser: mocks.insertScimUser,
  toUserResourceRow: (record: Record<string, unknown>) => ({
    id: record.id,
    externalId: record.externalId,
    userName: record.userName,
    active: record.active && record.userSuspendedAt === null,
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
import { provisionScimUser } from '@/ee/scim/lib/application/users/provision-user'
import { ScimError, uniqueness } from '@/ee/scim/lib/protocol/errors'

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

function stageConnection() {
  queueTableRows(scimConnection, [
    { id: 'conn-1', organizationId: 'org-1', status: 'active', settings: { autoMap: true } },
  ])
}

function stageReadBack(userId: string, stored: ScimUserAttributes, suspendedAt: Date | null) {
  mocks.findScimUserById.mockResolvedValue({
    id: 'su-new',
    userId,
    externalId: stored.externalId ?? null,
    userName: stored.userName,
    active: stored.active,
    attributes: stored,
    email: 'ada@acme.test',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    userSuspendedAt: suspendedAt,
  })
}

const run = (input: ScimUserAttributes) =>
  provisionScimUser.execute({ principal, input: { attributes: input }, request: undefined })

const auditActions = () =>
  mocks.recordAudit.mock.calls[0][0].entries.map((entry: { action: string }) => entry.action)

afterAll(resetDbChainMock)

describe('provisionScimUser', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.assertUserNameAvailable.mockResolvedValue(undefined)
    mocks.assertEmailAvailable.mockResolvedValue(undefined)
    mocks.consumeTombstone.mockResolvedValue(undefined)
    mocks.syncIdentity.mockResolvedValue(false)
    mocks.suspend.mockResolvedValue(undefined)
    mocks.unsuspend.mockResolvedValue(undefined)
    mocks.isInstanceMode.mockReturnValue(false)
    mocks.getInstanceOrganizationId.mockResolvedValue(null)
    mocks.resolveIdentity.mockResolvedValue({ action: 'create' })
    mocks.createUser.mockResolvedValue({ user: { id: 'u-new' } })
    mocks.findScimUserByUserId.mockResolvedValue(null)
    mocks.resolveSeatPolicy.mockResolvedValue({ organizationSubscriptionId: 'sub-1' })
    mocks.ensureMember.mockResolvedValue({ success: true, memberId: 'm-1', alreadyMember: false })
    mocks.insertScimUser.mockResolvedValue({ id: 'su-new' })
    mocks.reconcile.mockResolvedValue({ added: [], removed: [], raised: [] })
    mocks.deleteAccount.mockResolvedValue({})
    mocks.applySessionPolicy.mockResolvedValue(undefined)
    mocks.reconcileSeats.mockResolvedValue({ changed: false })
    mocks.syncUsageLimits.mockResolvedValue(undefined)
    stageReadBack('u-new', attributes(), null)
  })

  it('refuses a duplicate userName as a uniqueness conflict before touching Better Auth', async () => {
    stageConnection()
    mocks.assertUserNameAvailable.mockRejectedValue(
      uniqueness('A user with userName ada@acme.test already exists in this directory')
    )
    const error = await run(attributes()).catch((caught) => caught)
    expect(error).toBeInstanceOf(ScimError)
    expect(error.status).toBe(409)
    expect(error.scimType).toBe('uniqueness')
    expect(mocks.createUser).not.toHaveBeenCalled()
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('reports seat exhaustion as a plain 409 and removes the orphan account', async () => {
    stageConnection()
    mocks.ensureMember.mockResolvedValue({
      success: false,
      alreadyMember: false,
      failureCode: 'no-seats-available',
    })
    const error = await run(attributes()).catch((caught) => caught)
    expect(error).toBeInstanceOf(ScimError)
    expect(error.status).toBe(409)
    expect(error.scimType).toBeUndefined()
    expect(error.message).toContain('no available seats')
    expect(mocks.insertScimUser).not.toHaveBeenCalled()
    expect(mocks.reconcile).not.toHaveBeenCalled()
    expect(mocks.deleteAccount).toHaveBeenCalledWith('u-new')
    expect(mocks.recordAudit).not.toHaveBeenCalled()
    expect(mocks.reconcileSeats).not.toHaveBeenCalled()
  })

  it('removes the orphan account when the transaction fails after the account was created', async () => {
    stageConnection()
    mocks.insertScimUser.mockRejectedValue(new Error('lock timeout'))
    const error = await run(attributes()).catch((caught) => caught)
    expect(error.message).toBe('lock timeout')
    expect(mocks.deleteAccount).toHaveBeenCalledWith('u-new')
  })

  it('never deletes a pre-existing account when linking fails', async () => {
    stageConnection()
    mocks.resolveIdentity.mockResolvedValue({
      action: 'link',
      userId: 'u-old',
      via: 'verified-domain',
    })
    mocks.ensureMember.mockResolvedValue({
      success: false,
      alreadyMember: false,
      failureCode: 'no-seats-available',
    })
    const error = await run(attributes()).catch((caught) => caught)
    expect(error.status).toBe(409)
    expect(mocks.createUser).not.toHaveBeenCalled()
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
  })

  it('lands an inactive create suspended, and signs the member out after commit', async () => {
    stageConnection()
    const inactive = attributes({ active: false })
    stageReadBack('u-new', inactive, new Date('2026-01-02T00:00:00.000Z'))
    const result = await run(inactive)
    expect(mocks.insertScimUser).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ userId: 'u-new', active: false })
    )
    expect(mocks.suspend).toHaveBeenCalledWith(db, {
      userId: 'u-new',
      organizationId: 'org-1',
      source: 'scim',
    })
    expect(mocks.suspend.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.insertScimUser.mock.invocationCallOrder[0]
    )
    expect(mocks.unsuspend).not.toHaveBeenCalled()
    expect(result.resource.active).toBe(false)
    expect(mocks.invalidate).toHaveBeenCalledWith({ userId: 'u-new', organizationId: 'org-1' })
  })

  it('refuses an inactive create that links the organization owner without reporting success', async () => {
    stageConnection()
    mocks.resolveIdentity.mockResolvedValue({
      action: 'link',
      userId: 'owner',
      via: 'verified-domain',
    })
    mocks.ensureMember.mockResolvedValue({
      success: true,
      memberId: 'm-owner',
      alreadyMember: true,
    })
    mocks.suspend.mockRejectedValueOnce(
      new OrchestrationError('conflict', 'Transfer ownership first')
    )
    await expect(run(attributes({ active: false }))).rejects.toMatchObject({ code: 'conflict' })
    expect(mocks.consumeTombstone).not.toHaveBeenCalled()
    expect(mocks.reconcile).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
  })

  it('relinks a tombstoned account instead of creating a new one', async () => {
    stageConnection()
    mocks.resolveIdentity.mockResolvedValue({ action: 'link', userId: 'u-old', via: 'tombstone' })
    mocks.ensureMember.mockResolvedValue({ success: true, memberId: 'm-1', alreadyMember: true })
    stageReadBack('u-old', attributes(), null)
    const result = await run(attributes())

    expect(mocks.createUser).not.toHaveBeenCalled()
    expect(mocks.assertEmailAvailable).not.toHaveBeenCalled()
    expect(mocks.findScimUserByUserId).toHaveBeenCalledWith(db, 'conn-1', 'u-old')
    expect(mocks.syncIdentity).toHaveBeenCalledWith(db, {
      userId: 'u-old',
      email: 'ada@acme.test',
      name: 'Ada Lovelace',
    })
    expect(mocks.unsuspend).toHaveBeenCalledWith(db, { userId: 'u-old', source: 'scim' })
    expect(mocks.insertScimUser).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ userId: 'u-old', active: true })
    )
    expect(mocks.consumeTombstone).toHaveBeenCalledWith(db, {
      connectionId: 'conn-1',
      externalId: 'ext-1',
    })
    expect(mocks.consumeTombstone.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.insertScimUser.mock.invocationCallOrder[0]
    )
    expect(result).toMatchObject({
      userId: 'u-old',
      createdAccount: false,
      joinedOrganization: false,
    })
    expect(auditActions()).toEqual(['scim_user.provisioned'])
    expect(mocks.captureEvent).toHaveBeenCalledWith(
      'u-old',
      'scim_user_provisioned',
      { organization_id: 'org-1', created_account: false },
      { groups: { organization: 'org-1' } }
    )
  })

  it('refuses to provision an account this connection already links', async () => {
    stageConnection()
    mocks.resolveIdentity.mockResolvedValue({
      action: 'link',
      userId: 'u-old',
      via: 'verified-domain',
    })
    mocks.findScimUserByUserId.mockResolvedValue({ id: 'su-existing', userId: 'u-old' })
    const error = await run(attributes()).catch((caught) => caught)
    expect(error.status).toBe(409)
    expect(error.scimType).toBe('uniqueness')
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })

  it('refuses a credential without the write scope before any lookup', async () => {
    stageConnection()
    const error = await provisionScimUser
      .execute({
        principal: { ...principal, scopes: ['users:read'] },
        input: { attributes: attributes() },
        request: undefined,
      })
      .catch((caught) => caught)
    expect(error.status).toBe(403)
    expect(mocks.resolveIdentity).not.toHaveBeenCalled()
  })
})
