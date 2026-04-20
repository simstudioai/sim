/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGenerateId } = vi.hoisted(() => ({
  mockGenerateId: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@sim/utils/id', () => ({
  generateId: mockGenerateId,
  generateShortId: vi.fn(() => 'short-id'),
}))

import {
  createOrganizationWithOwner,
  OrganizationSlugTakenError,
  validateOrganizationSlugOrThrow,
} from '@/lib/billing/organizations/create-organization'

function insertedValuesFor(predicate: (values: Record<string, unknown>) => boolean) {
  return dbChainMockFns.values.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter(predicate)
}

describe('createOrganizationWithOwner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates an organization with a Better Auth-compatible id prefix', async () => {
    mockGenerateId.mockReturnValueOnce('abc123').mockReturnValueOnce('member456')
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const result = await createOrganizationWithOwner({
      ownerUserId: 'user-1',
      name: 'My Org',
      slug: 'my-org',
      metadata: { source: 'test' },
    })

    expect(result).toEqual({
      organizationId: 'org_abc123',
      memberId: 'member456',
    })
    expect(insertedValuesFor((v) => 'slug' in v)).toEqual([
      expect.objectContaining({
        id: 'org_abc123',
        name: 'My Org',
        slug: 'my-org',
        metadata: { source: 'test' },
      }),
    ])
    expect(insertedValuesFor((v) => !('slug' in v))).toEqual([
      expect.objectContaining({
        id: 'member456',
        userId: 'user-1',
        organizationId: 'org_abc123',
        role: 'owner',
      }),
    ])
  })

  it('throws a typed error when the organization slug is already taken', async () => {
    mockGenerateId.mockReturnValueOnce('abc123').mockReturnValueOnce('member456')
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'existing-org' }])

    await expect(
      createOrganizationWithOwner({
        ownerUserId: 'user-1',
        name: 'My Org',
        slug: 'my-org',
      })
    ).rejects.toBeInstanceOf(OrganizationSlugTakenError)

    expect(insertedValuesFor(() => true)).toEqual([])
  })

  it('rejects invalid organization slugs before writing anything', () => {
    expect(() => validateOrganizationSlugOrThrow('Invalid Slug!')).toThrow(
      'Organization slug "Invalid Slug!" is invalid'
    )
  })
})
