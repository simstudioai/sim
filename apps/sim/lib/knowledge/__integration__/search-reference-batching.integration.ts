import { db } from '@sim/db'
import {
  knowledgeBase,
  knowledgeBaseTagDefinitions,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import {
  getActiveKnowledgeBaseReference,
  getActiveKnowledgeBaseReferences,
} from '@/lib/knowledge/service'
import {
  getDocumentTagDefinitions,
  getDocumentTagDefinitionsByKnowledgeBaseIds,
} from '@/lib/knowledge/tags/service'

describe('batched search reference reads', () => {
  const fixture = createKnowledgeAclFixtureIds()
  const baseIds = [fixture.knowledgeBaseId, ...Array.from({ length: 19 }, () => generateId())]
  const deletedBaseId = generateId()

  beforeAll(async () => {
    await seedKnowledgeAclFixture(fixture)
    await db.insert(knowledgeBase).values(
      [...baseIds.slice(1), deletedBaseId].map((id, index) => ({
        id,
        userId: fixture.aliceId,
        workspaceId: fixture.workspaceId,
        name: `Batched search fixture ${index}`,
        deletedAt: id === deletedBaseId ? new Date() : null,
      }))
    )
    await db.insert(knowledgeBaseTagDefinitions).values(
      baseIds.slice(0, -1).flatMap((knowledgeBaseId) =>
        (['tag3', 'tag2'] as const).map((tagSlot) => ({
          id: generateId(),
          knowledgeBaseId,
          tagSlot,
          displayName: tagSlot,
          fieldType: 'text' as const,
        }))
      )
    )
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    await db.delete(workspace).where(eq(workspace.id, fixture.workspaceId))
    await db.delete(organization).where(eq(organization.id, fixture.organizationId))
    await db.delete(user).where(inArray(user.id, [fixture.aliceId, fixture.bobId]))
    await db.$client.end()
  })

  it('returns identical active references with one query instead of twenty', async () => {
    const select = vi.spyOn(db, 'select')
    try {
      const expected = await Promise.all(baseIds.map(getActiveKnowledgeBaseReference))
      expect(select).toHaveBeenCalledTimes(20)
      select.mockClear()
      expect(await getActiveKnowledgeBaseReferences(baseIds)).toEqual(expected)
      expect(select).toHaveBeenCalledOnce()
    } finally {
      select.mockRestore()
    }
  })

  it('preserves input order, duplicates, missing identities, and soft deletion', async () => {
    const ids = [baseIds[8], generateId(), baseIds[0], deletedBaseId, baseIds[8]]
    expect(await getActiveKnowledgeBaseReferences(ids)).toEqual(
      await Promise.all(ids.map(getActiveKnowledgeBaseReference))
    )
  })

  it('returns identical ordered tag definitions with one query instead of twenty', async () => {
    const select = vi.spyOn(db, 'select')
    try {
      const expected = new Map(
        await Promise.all(
          baseIds.map(async (id) => [id, await getDocumentTagDefinitions(id)] as const)
        )
      )
      expect(select).toHaveBeenCalledTimes(20)
      select.mockClear()
      expect(await getDocumentTagDefinitionsByKnowledgeBaseIds(baseIds)).toEqual(expected)
      expect(select).toHaveBeenCalledOnce()
      expect(expected.get(baseIds.at(-1)!)).toEqual([])
    } finally {
      select.mockRestore()
    }
  })

  it('does not cache updated references or tag definitions across reads', async () => {
    await getActiveKnowledgeBaseReferences(baseIds)
    await getDocumentTagDefinitionsByKnowledgeBaseIds(baseIds)
    await db
      .update(knowledgeBase)
      .set({ name: 'Updated reference' })
      .where(eq(knowledgeBase.id, baseIds[0]))
    await db
      .update(knowledgeBaseTagDefinitions)
      .set({ displayName: 'Updated definition' })
      .where(
        and(
          eq(knowledgeBaseTagDefinitions.knowledgeBaseId, baseIds[0]),
          eq(knowledgeBaseTagDefinitions.tagSlot, 'tag1')
        )
      )
    const references = await getActiveKnowledgeBaseReferences(baseIds)
    const tags = await getDocumentTagDefinitionsByKnowledgeBaseIds(baseIds)
    expect(references[0]?.name).toBe('Updated reference')
    expect(
      tags.get(baseIds[0])?.find((definition) => definition.tagSlot === 'tag1')?.displayName
    ).toBe('Updated definition')
  })
})
