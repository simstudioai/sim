/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbState, mockGenerateId } = vi.hoisted(() => ({
  mockDbState: {
    selectResults: [] as any[],
    insertedOrganizations: [] as any[],
    insertedMembers: [] as any[],
  },
  mockGenerateId: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    transaction: vi.fn(async (callback: any) => {
      const tx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi
                .fn()
                .mockImplementation(() => Promise.resolve(mockDbState.selectResults.shift() ?? [])),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockImplementation(async (values: Record<string, unknown>) => {
            if ('slug' in values) {
              mockDbState.insertedOrganizations.push(values)
              return
            }

            mockDbState.insertedMembers.push(values)
          }),
        }),
      }

      return callback(tx)
    }),
  },
}))

vi.mock('@sim/db/schema', () => ({
  organization: {
    id: 'organization.id',
    slug: 'organization.slug',
  },
  member: {
    id: 'member.id',
    userId: 'member.userId',
    organizationId: 'member.organizationId',
    role: 'member.role',
    createdAt: 'member.createdAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  ne: vi.fn((field: unknown, value: unknown) => ({ type: 'ne', field, value })),
}))

vi.mock('@/lib/core/utils/uuid', () => ({
  generateId: mockGenerateId,
}))

import {
  createOrganizationWithOwner,
  OrganizationSlugTakenError,
  validateOrganizationSlugOrThrow,
} from '@/lib/billing/organizations/create-organization'

describe('createOrganizationWithOwner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbState.selectResults = []
    mockDbState.insertedOrganizations = []
    mockDbState.insertedMembers = []
  })

  it('creates an organization with a Better Auth-compatible id prefix', async () => {
    mockGenerateId.mockReturnValueOnce('abc123').mockReturnValueOnce('member456')
    mockDbState.selectResults = [[]]

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
    expect(mockDbState.insertedOrganizations).toEqual([
      expect.objectContaining({
        id: 'org_abc123',
        name: 'My Org',
        slug: 'my-org',
        metadata: { source: 'test' },
      }),
    ])
    expect(mockDbState.insertedMembers).toEqual([
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
    mockDbState.selectResults = [[{ id: 'existing-org' }]]

    await expect(
      createOrganizationWithOwner({
        ownerUserId: 'user-1',
        name: 'My Org',
        slug: 'my-org',
      })
    ).rejects.toBeInstanceOf(OrganizationSlugTakenError)

    expect(mockDbState.insertedOrganizations).toEqual([])
    expect(mockDbState.insertedMembers).toEqual([])
  })

  it('rejects invalid organization slugs before writing anything', () => {
    expect(() => validateOrganizationSlugOrThrow('Invalid Slug!')).toThrow(
      'Organization slug "Invalid Slug!" is invalid'
    )
  })
})
