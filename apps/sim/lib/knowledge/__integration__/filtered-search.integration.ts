/** Real PostgreSQL ranking and source ACLs; all rows belong to a disposable fixture workspace. */
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeBase,
  knowledgeExternalGroupMember,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { confluencePageAcl } from '@/lib/knowledge/access/confluence-permissions'
import { resolveKnowledgeAccessScope } from '@/lib/knowledge/access/scope'
import { executeKnowledgeSearch } from '@/lib/knowledge/search/queries'

describe('bounded filtered vector retrieval', () => {
  const ids = createKnowledgeAclFixtureIds()
  const secondBaseId = generateId()
  const alice: Principal = { kind: 'session', userId: ids.aliceId, sessionId: 'fixture-alice' }
  const bob: Principal = { kind: 'personal_api_key', userId: ids.bobId, keyId: 'fixture-bob' }
  const workspaceKey: Principal = {
    kind: 'workspace_api_key',
    workspaceId: ids.workspaceId,
    keyId: 'fixture-key',
  }
  const restrictedAcl = confluencePageAcl({
    providerId: 'confluence',
    tenantId: 'fixture-tenant',
    spacePrincipals: [{ kind: 'group', id: 'space' }],
    restrictionChain: [[{ kind: 'group', id: 'parent' }], [{ kind: 'group', id: 'page' }]],
  })
  const fixtures = [
    { name: 'first', y: 0.3 },
    { name: 'second', y: 0.45, secondBase: true },
    { name: 'third', y: 0.6 },
    { name: 'workspace', y: 0.7, workspace: true },
    { name: 'denied', y: 0.01, denied: true },
    { name: 'stale', y: 0.02, stale: true },
    { name: 'excluded', y: 0.03, excluded: true },
    { name: 'disabled-chunk', y: 0.04, disabled: true },
    { name: 'distant', y: 10 },
    ...Array.from({ length: 80 }, (_, index) => ({
      name: `other-tag-${index}`,
      y: 0.05,
      otherTag: true,
    })),
  ].map((fixture) => ({ ...fixture, documentId: generateId(), embeddingId: generateId() }))

  beforeAll(async () => {
    await seedKnowledgeAclFixture(ids)
    await db.insert(knowledgeBase).values({
      id: secondBaseId,
      userId: ids.aliceId,
      workspaceId: ids.workspaceId,
      name: 'Second filtered-search fixture',
    })
    for (const fixture of fixtures) {
      const knowledgeBaseId = 'secondBase' in fixture ? secondBaseId : ids.knowledgeBaseId
      const tag = 'otherTag' in fixture ? 'other' : 'common'
      await db.insert(document).values({
        id: fixture.documentId,
        knowledgeBaseId,
        filename: fixture.name,
        fileUrl: `https://fixture.invalid/${fixture.documentId}`,
        fileSize: 12,
        mimeType: 'text/plain',
        processingStatus: 'completed',
        connectorId: 'workspace' in fixture ? null : ids.connectorId,
        acl:
          'workspace' in fixture
            ? ['ws']
            : 'denied' in fixture
              ? ['g:confluence:fixture-tenant:missing']
              : [...restrictedAcl.acl],
        aclRequirements:
          'workspace' in fixture ? [] : restrictedAcl.requirements.map((clause) => [...clause]),
        aclVerifiedAt: 'stale' in fixture ? new Date(0) : new Date(),
        userExcluded: 'excluded' in fixture,
        tag1: tag,
      })
      await db.insert(embedding).values({
        id: fixture.embeddingId,
        documentId: fixture.documentId,
        knowledgeBaseId,
        chunkIndex: 0,
        chunkHash: fixture.embeddingId,
        content: `Orion ${fixture.name}`,
        contentLength: 12,
        tokenCount: 3,
        startOffset: 0,
        endOffset: 12,
        embeddingModel: 'text-embedding-3-small',
        embedding: [1, fixture.y, ...Array<number>(1534).fill(0)],
        tag1: tag,
        enabled: !('disabled' in fixture),
      })
    }
  })

  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(user).where(eq(user.id, ids.aliceId))
    await db.delete(user).where(eq(user.id, ids.bobId))
    await db.$client.end()
  })

  async function search(principal: Principal, mode: 'vector' | 'hybrid' = 'vector') {
    const access = await resolveKnowledgeAccessScope(principal, { workspaceId: ids.workspaceId })
    const rows = await executeKnowledgeSearch({
      knowledgeBaseIds: [ids.knowledgeBaseId, secondBaseId],
      topK: 3,
      access,
      searchMode: mode,
      query: 'Orion',
      queryVector: {
        vector: JSON.stringify([1, ...Array<number>(1535).fill(0)]),
        dimensions: 1536,
      },
      structuredFilters: [{ tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'common' }],
    })
    return rows.map((row) => fixtures.find((fixture) => fixture.embeddingId === row.id)!.name)
  }

  it('keeps global nearest-neighbor order across bases after selective tag and source restrictions', async () => {
    expect(await search(alice)).toEqual(['first', 'second', 'third'])
  })

  it('enforces the same ACL intersection for a personal key and a workspace key', async () => {
    expect(await search(bob)).toEqual(['workspace'])
    expect(await search(workspaceKey)).toEqual(['workspace'])
  })

  it('keeps filtered hybrid candidates within the same visible source documents', async () => {
    const matches = await search(alice, 'hybrid')
    expect(matches).toHaveLength(3)
    expect(
      matches.every((name) => ['first', 'second', 'third', 'workspace', 'distant'].includes(name))
    ).toBe(true)
    expect(await search(bob, 'hybrid')).toEqual(['workspace'])
  })

  it('removes previously ranked source results when a required group membership is revoked', async () => {
    await db
      .delete(knowledgeExternalGroupMember)
      .where(
        and(
          eq(knowledgeExternalGroupMember.groupId, ids.groupIds[2]),
          eq(knowledgeExternalGroupMember.subjectToken, `u:${ids.aliceId}@fixture.test`)
        )
      )
    expect(await search(alice)).toEqual(['workspace'])
    expect(await search(alice, 'hybrid')).toEqual(['workspace'])
  })
})
