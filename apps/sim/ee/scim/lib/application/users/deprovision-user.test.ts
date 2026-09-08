/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { member, scimConnection } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  removeUser: vi.fn(),
  reconcileSeats: vi.fn(),
  endDirectoryMembership: vi.fn(),
  findScimUserById: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  removeUserFromOrganization: mocks.removeUser,
}))
vi.mock('@/lib/billing/organizations/seats', () => ({
  reconcileOrganizationSeats: mocks.reconcileSeats,
}))
vi.mock('@/ee/scim/lib/identity/end-directory-membership', () => ({
  endDirectoryMembershipTx: mocks.endDirectoryMembership,
}))
vi.mock('@/ee/scim/lib/repository/users', () => ({
  findScimUserById: mocks.findScimUserById,
}))
vi.mock('@/ee/scim/lib/application/audit', () => ({
  recordScimAuditEntries: mocks.recordAudit,
}))
vi.mock('@/ee/scim/lib/base-url', () => ({ scimBaseUrl: () => 'https://sim.test/api/scim/v2' }))

import type { Principal } from '@sim/auth/principal'
import { deprovisionScimUser } from '@/ee/scim/lib/application/users/deprovision-user'
import { ScimError } from '@/ee/scim/lib/protocol/errors'

const principal: Principal = {
  kind: 'scim_connection',
  organizationId: 'org-1',
  connectionId: 'conn-1',
  credentialId: 'cred-1',
  scopes: ['users:write'],
}

function stage(membership: Array<{ id: string; role: string }>) {
  queueTableRows(scimConnection, [
    { id: 'conn-1', organizationId: 'org-1', status: 'active', settings: {} },
  ])
  queueTableRows(member, membership)
  mocks.findScimUserById.mockResolvedValue({ id: 'su-1', userId: 'u-1', externalId: 'ext-1' })
}

afterAll(resetDbChainMock)

describe('deprovisionScimUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.removeUser.mockResolvedValue({ success: true })
    mocks.endDirectoryMembership.mockResolvedValue({ removed: 1 })
    mocks.reconcileSeats.mockResolvedValue({ changed: false })
  })

  it('removes a member through the shared primitive and audits the removal', async () => {
    stage([{ id: 'm-1', role: 'member' }])
    const result = await deprovisionScimUser.execute({
      principal,
      input: { scimUserId: 'su-1' },
      request: undefined,
    })
    expect(mocks.removeUser).toHaveBeenCalledWith({
      userId: 'u-1',
      organizationId: 'org-1',
      memberId: 'm-1',
      revokePersonalApiKeys: true,
    })
    expect(mocks.endDirectoryMembership).not.toHaveBeenCalled()
    expect(result.removedFromOrganization).toBe(true)
    const actions = mocks.recordAudit.mock.calls[0][0].entries.map(
      (entry: { action: string }) => entry.action
    )
    expect(actions).toEqual(['scim_user.deprovisioned', 'org_member.removed'])
    expect(mocks.reconcileSeats).toHaveBeenCalledWith({
      organizationId: 'org-1',
      reason: 'scim-member-removed',
    })
  })

  it('refuses to deprovision the owner with a conflict that is not a duplicate', async () => {
    stage([{ id: 'm-1', role: 'owner' }])
    const error = await deprovisionScimUser
      .execute({ principal, input: { scimUserId: 'su-1' }, request: undefined })
      .catch((caught) => caught)
    expect(error).toBeInstanceOf(ScimError)
    expect(error.status).toBe(409)
    expect(error.scimType).toBeUndefined()
    expect(mocks.removeUser).not.toHaveBeenCalled()
  })

  it('retires only the directory row when the account already left the organization', async () => {
    stage([])
    const result = await deprovisionScimUser.execute({
      principal,
      input: { scimUserId: 'su-1' },
      request: undefined,
    })
    expect(mocks.removeUser).not.toHaveBeenCalled()
    expect(mocks.endDirectoryMembership).toHaveBeenCalledWith(db, {
      userId: 'u-1',
      organizationId: 'org-1',
    })
    expect(result.removedFromOrganization).toBe(false)
    expect(mocks.reconcileSeats).not.toHaveBeenCalled()
    const actions = mocks.recordAudit.mock.calls[0][0].entries.map(
      (entry: { action: string }) => entry.action
    )
    expect(actions).toEqual(['scim_user.deprovisioned'])
  })

  it('surfaces a refused removal as a conflict the directory can show', async () => {
    stage([{ id: 'm-1', role: 'member' }])
    mocks.removeUser.mockResolvedValue({
      success: false,
      error: 'Workflows could not be reassigned',
    })
    const error = await deprovisionScimUser
      .execute({ principal, input: { scimUserId: 'su-1' }, request: undefined })
      .catch((caught) => caught)
    expect(error.status).toBe(409)
    expect(error.message).toBe('Workflows could not be reassigned')
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('answers 404 for an id this connection does not own', async () => {
    queueTableRows(scimConnection, [
      { id: 'conn-1', organizationId: 'org-1', status: 'active', settings: {} },
    ])
    mocks.findScimUserById.mockResolvedValue(null)
    const error = await deprovisionScimUser
      .execute({ principal, input: { scimUserId: 'other' }, request: undefined })
      .catch((caught) => caught)
    expect(error.status).toBe(404)
  })
})
