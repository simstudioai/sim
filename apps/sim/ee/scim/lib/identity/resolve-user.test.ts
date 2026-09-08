/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { member, type ScimUserAttributes, scimUserTombstone, ssoDomain, user } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertEmailAvailable,
  resolveProvisionedIdentity,
} from '@/ee/scim/lib/identity/resolve-user'
import { ScimError } from '@/ee/scim/lib/protocol/errors'

function attributes(overrides: Partial<ScimUserAttributes> = {}): ScimUserAttributes {
  return {
    userName: 'ada@acme.com',
    name: { formatted: 'Ada Lovelace' },
    emails: [{ value: 'ada@acme.com', primary: true }],
    active: true,
    ...overrides,
  }
}

const params = { connectionId: 'conn-1', organizationId: 'org-1' }

async function expectScimError(promise: Promise<unknown>, status: number, scimType: string) {
  const error = await promise.catch((caught) => caught)
  expect(error).toBeInstanceOf(ScimError)
  expect(error.status).toBe(status)
  expect(error.scimType).toBe(scimType)
  return error as ScimError
}

afterAll(resetDbChainMock)

describe('resolveProvisionedIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('refuses every address when the organization has verified no domain', async () => {
    queueTableRows(ssoDomain, [])
    queueTableRows(scimUserTombstone, [{ userId: 'user-old' }])
    const error = await expectScimError(
      resolveProvisionedIdentity(db, { ...params, attributes: attributes() }),
      400,
      'invalidValue'
    )
    expect(error.message).toContain('no verified email domains')
  })

  it('refuses an address outside the verified domains before consulting any tombstone', async () => {
    queueTableRows(ssoDomain, [{ domain: 'acme.com' }])
    queueTableRows(scimUserTombstone, [{ userId: 'user-old' }])
    const error = await expectScimError(
      resolveProvisionedIdentity(db, {
        ...params,
        attributes: attributes({
          externalId: 'ext-1',
          emails: [{ value: 'ada@evil.example', primary: true }],
        }),
      }),
      400,
      'invalidValue'
    )
    expect(error.message).toContain('evil.example')
    /** Only the domain read ran; the tombstone queue is untouched. */
    expect(dbChainMockFns.from).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.from).toHaveBeenCalledWith(ssoDomain)
  })

  it('relinks through a tombstone left by this connection before looking at email', async () => {
    queueTableRows(ssoDomain, [{ domain: 'ACME.com' }])
    queueTableRows(scimUserTombstone, [{ userId: 'user-old' }])
    queueTableRows(user, [{ id: 'user-other' }])
    await expect(
      resolveProvisionedIdentity(db, { ...params, attributes: attributes({ externalId: 'ext-1' }) })
    ).resolves.toEqual({ action: 'link', userId: 'user-old', via: 'tombstone' })
    expect(dbChainMockFns.where).toHaveBeenCalledWith({
      type: 'and',
      conditions: [
        { type: 'eq', left: scimUserTombstone.connectionId, right: 'conn-1' },
        { type: 'eq', left: scimUserTombstone.externalId, right: 'ext-1' },
      ],
    })
  })

  it('creates when nobody holds the address', async () => {
    queueTableRows(ssoDomain, [{ domain: 'acme.com' }])
    queueTableRows(user, [])
    await expect(
      resolveProvisionedIdentity(db, { ...params, attributes: attributes() })
    ).resolves.toEqual({ action: 'create' })
  })

  it('links an existing account in this organization or in none', async () => {
    queueTableRows(ssoDomain, [{ domain: 'acme.com' }])
    queueTableRows(user, [{ id: 'user-1' }])
    queueTableRows(member, [])
    await expect(
      resolveProvisionedIdentity(db, { ...params, attributes: attributes() })
    ).resolves.toEqual({ action: 'link', userId: 'user-1', via: 'verified-domain' })

    queueTableRows(ssoDomain, [{ domain: 'acme.com' }])
    queueTableRows(user, [{ id: 'user-1' }])
    queueTableRows(member, [{ organizationId: 'org-1' }])
    await expect(
      resolveProvisionedIdentity(db, { ...params, attributes: attributes() })
    ).resolves.toEqual({ action: 'link', userId: 'user-1', via: 'verified-domain' })
  })

  it('reports an account committed to another organization as a uniqueness conflict', async () => {
    queueTableRows(ssoDomain, [{ domain: 'acme.com' }])
    queueTableRows(user, [{ id: 'user-1' }])
    queueTableRows(member, [{ organizationId: 'org-2' }])
    const error = await expectScimError(
      resolveProvisionedIdentity(db, { ...params, attributes: attributes() }),
      409,
      'uniqueness'
    )
    expect(error.message).toContain('different organization')
  })
})

describe('assertEmailAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('allows the address when it is free or already the same account', async () => {
    queueTableRows(user, [])
    await expect(assertEmailAvailable(db, 'ada@acme.com')).resolves.toBeUndefined()
    queueTableRows(user, [{ id: 'user-1' }])
    await expect(assertEmailAvailable(db, 'ada@acme.com', 'user-1')).resolves.toBeUndefined()
  })

  it('refuses an address another account holds', async () => {
    queueTableRows(user, [{ id: 'user-2' }])
    await expectScimError(assertEmailAvailable(db, 'ada@acme.com', 'user-1'), 409, 'uniqueness')
  })
})
