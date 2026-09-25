import { db } from '@sim/db'
import { member, scimConnection } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import {
  organizationSeatsMock,
  organizationSeatsMockFns,
} from '@sim/testing/mocks/organization-seats.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const hoistedMocks = vi.hoisted(() => ({
  endDirectoryMembership: vi.fn(),
  findScimUserById: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)
vi.mock('@/lib/billing/organizations/seats', () => organizationSeatsMock)
vi.mock('@/ee/scim/lib/identity/end-directory-membership', () => ({
  endDirectoryMembershipTx: hoistedMocks.endDirectoryMembership,
}))
vi.mock('@/ee/scim/lib/repository/users', () => ({
  findScimUserById: hoistedMocks.findScimUserById,
}))
vi.mock('@/ee/scim/lib/application/audit', () => ({
  recordScimAuditEntries: hoistedMocks.recordAudit,
}))
vi.mock('@/ee/scim/lib/base-url', () => ({ scimBaseUrl: () => 'https://sim.test/api/scim/v2' }))

import type { Principal } from '@sim/auth/principal'
import { deprovisionScimUser } from '@/ee/scim/lib/application/users/deprovision-user'
import { ScimError } from '@/ee/scim/lib/protocol/errors'

const mocks = {
  ...hoistedMocks,
  reconcileSeats: organizationSeatsMockFns.mockReconcileOrganizationSeats,
  removeUser: organizationMembershipMockFns.mockRemoveUserFromOrganization,
}

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
    resetDbChainMock()
    mocks.removeUser.mockResolvedValue({ success: true })
    mocks.endDirectoryMembership.mockResolvedValue({ removed: 1 })
    mocks.reconcileSeats.mockResolvedValue({ changed: false })
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
