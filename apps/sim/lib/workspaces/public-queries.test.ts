/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryPublicWorkspaceMembers } from '@/lib/workspaces/public-queries'

describe('queryPublicWorkspaceMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('deduplicates inherited org admins and promotes their effective role', async () => {
    queueTableRows(schemaMock.workspace, [{ ownerId: 'user-1', organizationId: 'org-1' }])
    queueTableRows(schemaMock.permissions, [
      {
        userId: 'user-1',
        email: 'ada@example.com',
        name: 'Ada',
        image: null,
        role: 'write',
        joinedAt: new Date('2026-01-01T00:00:00.000Z'),
        hasRelevantOrganizationMembership: true,
      },
      {
        userId: 'user-2',
        email: 'grace@example.com',
        name: 'Grace',
        image: null,
        role: 'read',
        joinedAt: new Date('2026-01-02T00:00:00.000Z'),
        hasRelevantOrganizationMembership: false,
      },
    ])
    queueTableRows(schemaMock.member, [
      {
        userId: 'user-1',
        email: 'ada@example.com',
        name: 'Ada',
        image: null,
        joinedAt: new Date('2025-12-01T00:00:00.000Z'),
      },
    ])

    const page = await queryPublicWorkspaceMembers('workspace-1', { limit: 10 })

    expect(page?.members).toEqual([
      {
        userId: 'user-1',
        email: 'ada@example.com',
        name: 'Ada',
        image: null,
        role: 'admin',
        isExternal: false,
        joinedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        userId: 'user-2',
        email: 'grace@example.com',
        name: 'Grace',
        image: null,
        role: 'read',
        isExternal: true,
        joinedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ])
    expect(page?.nextEmail).toBeNull()
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(11)
    expect(dbChainMockFns.leftJoin).not.toHaveBeenCalled()
  })

  it('marks organization members as external collaborators on a personal workspace', async () => {
    queueTableRows(schemaMock.workspace, [{ ownerId: 'user-1', organizationId: null }])
    queueTableRows(schemaMock.permissions, [
      {
        userId: 'user-1',
        email: 'ada@example.com',
        name: 'Ada',
        image: null,
        role: 'admin',
        joinedAt: new Date('2026-01-01T00:00:00.000Z'),
        hasRelevantOrganizationMembership: true,
      },
      {
        userId: 'user-2',
        email: 'grace@example.com',
        name: 'Grace',
        image: null,
        role: 'read',
        joinedAt: new Date('2026-01-02T00:00:00.000Z'),
        hasRelevantOrganizationMembership: true,
      },
      {
        userId: 'user-3',
        email: 'katherine@example.com',
        name: 'Katherine',
        image: null,
        role: 'read',
        joinedAt: new Date('2026-01-03T00:00:00.000Z'),
        hasRelevantOrganizationMembership: false,
      },
    ])

    const page = await queryPublicWorkspaceMembers('workspace-1', { limit: 10 })

    expect(page?.members.map(({ email, isExternal }) => ({ email, isExternal }))).toEqual([
      { email: 'ada@example.com', isExternal: false },
      { email: 'grace@example.com', isExternal: true },
      { email: 'katherine@example.com', isExternal: false },
    ])
  })

  it('returns null when the workspace is not active', async () => {
    queueTableRows(schemaMock.workspace, [])

    await expect(
      queryPublicWorkspaceMembers('missing-workspace', { limit: 10 })
    ).resolves.toBeNull()
  })
})
