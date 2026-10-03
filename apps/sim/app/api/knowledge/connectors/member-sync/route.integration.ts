/**
 * The member sync scheduler's reclaim against real PostgreSQL: a members-mode connector whose
 * member lease went stale is put back on the failure ladder, and a connector in any other access
 * mode is left exactly as it is, whatever its member columns say.
 */

import { db } from '@sim/db'
import { knowledgeConnector, organization, user, workspace } from '@sim/db/schema'
import { createMockRequest } from '@sim/testing'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/internal', () => ({ verifyCronAuth: () => null }))
vi.mock('@/lib/knowledge/connectors/member-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/knowledge/connectors/member-queue')>()),
  dispatchMemberSync: vi.fn(async () => undefined),
}))

import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { GET } from '@/app/api/knowledge/connectors/member-sync/route'

describe('member sync reclaim in PostgreSQL', () => {
  const ids = createKnowledgeAclFixtureIds()
  const members = generateId()
  const admin = generateId()
  const staleLease = new Date(Date.now() - 24 * 60 * 60 * 1000)

  beforeAll(async () => {
    await seedKnowledgeAclFixture(ids)
    await db.insert(knowledgeConnector).values(
      [
        { id: members, accessMode: 'members' },
        { id: admin, accessMode: 'admin' },
      ].map(({ id, accessMode }) => ({
        id,
        knowledgeBaseId: ids.knowledgeBaseId,
        connectorType: 'google_drive',
        sourceConfig: {},
        accessMode,
        status: 'active',
        credentialId: ids.credentialId,
        memberSyncStatus: 'running',
        memberSyncLockToken: generateId(),
        memberSyncLockLeaseAt: staleLease,
      }))
    )
  })

  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    await db.$client.end()
  })

  it('reclaims a stale members-mode lease and leaves every other access mode alone', async () => {
    const response = await GET(createMockRequest('GET'), undefined)
    expect(response.status).toBe(200)
    const rows = await db
      .select({
        id: knowledgeConnector.id,
        memberSyncStatus: knowledgeConnector.memberSyncStatus,
        memberSyncLockToken: knowledgeConnector.memberSyncLockToken,
      })
      .from(knowledgeConnector)
      .where(inArray(knowledgeConnector.id, [members, admin]))
    const byId = new Map(rows.map((row) => [row.id, row]))
    expect(byId.get(members)).toMatchObject({
      memberSyncStatus: 'error',
      memberSyncLockToken: null,
    })
    expect(byId.get(admin)?.memberSyncStatus).toBe('running')
    expect(byId.get(admin)?.memberSyncLockToken).not.toBeNull()
  })
})
