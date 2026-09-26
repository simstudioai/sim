import { db } from '@sim/db'
import {
  document,
  knowledgeBase,
  knowledgeConnector,
  member,
  organization,
  organizationSearchHistory,
  organizationSearchIntegration,
  user,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSearchHistory,
  listSearchHistory,
  recordSearchHistory,
} from '@/lib/knowledge/application/search-history'
import { SEARCH_HISTORY_LIMIT } from '@/lib/knowledge/search/history/limits'

vi.mock('@/lib/knowledge/access/availability', () => ({
  requireOrganizationSearchAvailable: vi.fn(),
  resolveKnowledgeAccessAvailability: vi.fn(async () => ({
    sourceMirrored: true,
    memberScoped: true,
  })),
}))

const userIds = [generateId(), generateId()]
const orgIds = [generateId(), generateId()]
const indexId = generateId()
const connectorId = generateId()
const principal = { kind: 'session', userId: userIds[0], sessionId: 'history-test' } as const
const input = { organizationId: orgIds[0] }
const scope = and(
  eq(organizationSearchHistory.organizationId, orgIds[0]),
  eq(organizationSearchHistory.userId, userIds[0])
)
const source = {
  url: 'https://docs.google.com/document/d/history-fixture',
  title: 'Launch review',
}

beforeAll(async () => {
  await db.insert(user).values(
    userIds.map((id) => ({
      id,
      name: 'History fixture',
      email: `${id}@fixture.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db
    .insert(organization)
    .values(orgIds.map((id) => ({ id, name: 'History fixture', slug: id })))
  await db.insert(knowledgeBase).values({
    id: indexId,
    organizationId: orgIds[0],
    userId: userIds[0],
    name: 'Search',
    isSearchIndex: true,
  })
  await db.insert(knowledgeConnector).values({
    id: connectorId,
    knowledgeBaseId: indexId,
    connectorType: 'google_drive',
    sourceConfig: {},
    accessMode: 'admin',
  })
  await db.insert(member).values(
    userIds.map((userId) => ({
      id: generateId(),
      organizationId: orgIds[0],
      userId,
      role: 'member',
    }))
  )
})
beforeEach(async () => {
  await db
    .delete(organizationSearchIntegration)
    .where(eq(organizationSearchIntegration.organizationId, orgIds[0]))
  await db
    .update(knowledgeConnector)
    .set({ archivedAt: null })
    .where(eq(knowledgeConnector.id, connectorId))
  await db.delete(document).where(eq(document.knowledgeBaseId, indexId))
  await db.insert(document).values(
    [
      source.url,
      'https://example.com/other',
      ...Array.from({ length: 24 }, (_, i) => `https://example.com/${i}`),
    ].map((url) => ({
      id: generateId(),
      knowledgeBaseId: indexId,
      filename: url === 'https://example.com/23' ? 'Updated title' : source.title,
      fileUrl: url,
      sourceUrl: url,
      fileSize: 1,
      mimeType: 'text/plain',
      acl: ['pub'],
      connectorId,
      aclVerifiedAt: new Date(),
      processingStatus: 'completed',
    }))
  )
  await db
    .delete(organizationSearchHistory)
    .where(inArray(organizationSearchHistory.organizationId, orgIds))
})
afterAll(async () => {
  await db.delete(organization).where(inArray(organization.id, orgIds))
  await db.delete(user).where(inArray(user.id, userIds))
})

describe('private search navigation history', () => {
  it('isolates users and organizations and revokes access with membership', async () => {
    await recordSearchHistory.execute({
      principal,
      input: { ...input, event: { kind: 'source', source } },
    })
    expect((await listSearchHistory.execute({ principal, input })).sources).toMatchObject([source])
    expect(
      await listSearchHistory.execute({ principal: { ...principal, userId: userIds[1] }, input })
    ).toEqual({ sources: [], queries: [] })
    const secondPrincipal = { ...principal, userId: userIds[1] }
    await recordSearchHistory.execute({
      principal: secondPrincipal,
      input: {
        ...input,
        event: { kind: 'source', source: { ...source, url: 'https://example.com/other' } },
      },
    })
    expect(
      (await listSearchHistory.execute({ principal, input })).sources.map((item) => item.url)
    ).toEqual([source.url])
    await clearSearchHistory.execute({ principal: secondPrincipal, input })
    expect(
      (await listSearchHistory.execute({ principal, input })).sources.map((item) => item.url)
    ).toEqual([source.url])
    await expect(
      listSearchHistory.execute({ principal, input: { organizationId: orgIds[1] } })
    ).rejects.toMatchObject({ code: 'not_found' })
    await db
      .update(member)
      .set({ organizationId: orgIds[1] })
      .where(eq(member.userId, principal.userId))
    expect(
      await listSearchHistory.execute({ principal, input: { organizationId: orgIds[1] } })
    ).toEqual({ sources: [], queries: [] })
    await db
      .update(member)
      .set({ organizationId: orgIds[0] })
      .where(eq(member.userId, principal.userId))
    await db
      .delete(member)
      .where(and(eq(member.userId, userIds[1]), eq(member.organizationId, orgIds[0])))
    const outsider = { ...principal, userId: userIds[1] }
    for (const operation of [listSearchHistory, clearSearchHistory]) {
      await expect(operation.execute({ principal: outsider, input })).rejects.toMatchObject({
        code: 'not_found',
      })
    }
    await expect(
      recordSearchHistory.execute({
        principal: outsider,
        input: { ...input, event: { kind: 'source', source } },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect((await listSearchHistory.execute({ principal, input })).sources).toHaveLength(1)
  })

  it('revalidates current document access and metadata instead of replaying saved titles', async () => {
    await recordSearchHistory.execute({
      principal,
      input: { ...input, event: { kind: 'source', source } },
    })
    await db
      .update(document)
      .set({ filename: 'Current title' })
      .where(eq(document.sourceUrl, source.url))
    expect((await listSearchHistory.execute({ principal, input })).sources[0]?.title).toBe(
      'Current title'
    )
    await db
      .update(document)
      .set({ acl: ['u:another@fixture.test'] })
      .where(eq(document.sourceUrl, source.url))
    expect((await listSearchHistory.execute({ principal, input })).sources).toEqual([])
    await db
      .update(document)
      .set({ acl: ['pub'], userExcluded: true })
      .where(eq(document.sourceUrl, source.url))
    expect((await listSearchHistory.execute({ principal, input })).sources).toEqual([])
    await db.update(document).set({ userExcluded: false }).where(eq(document.sourceUrl, source.url))
    await db
      .insert(organizationSearchIntegration)
      .values({ organizationId: orgIds[0], connectorType: 'google_drive', approved: false })
    expect((await listSearchHistory.execute({ principal, input })).sources).toEqual([])
    await db
      .delete(organizationSearchIntegration)
      .where(eq(organizationSearchIntegration.organizationId, orgIds[0]))
    await db
      .update(knowledgeConnector)
      .set({ archivedAt: new Date() })
      .where(eq(knowledgeConnector.id, connectorId))
    expect((await listSearchHistory.execute({ principal, input })).sources).toEqual([])
    await recordSearchHistory.execute({
      principal,
      input: {
        ...input,
        event: { kind: 'source', source: { ...source, url: 'https://example.com/unverifiable' } },
      },
    })
    expect((await listSearchHistory.execute({ principal, input })).sources).toEqual([])
  })

  it('deduplicates and bounds concurrent visits without losing unrelated queries', async () => {
    await recordSearchHistory.execute({
      principal,
      input: { ...input, event: { kind: 'query', query: 'launch' } },
    })
    for (let batch = 0; batch < 6; batch++) {
      await Promise.all(
        Array.from({ length: 4 }, (_, offset) =>
          recordSearchHistory.execute({
            principal,
            input: {
              ...input,
              event: {
                kind: 'source',
                source: { ...source, url: `https://example.com/${batch * 4 + offset}` },
              },
            },
          })
        )
      )
    }
    await recordSearchHistory.execute({
      principal,
      input: {
        ...input,
        event: {
          kind: 'source',
          source: { ...source, url: 'https://example.com/23' },
        },
      },
    })
    const result = await listSearchHistory.execute({ principal, input })
    expect(result.sources).toHaveLength(SEARCH_HISTORY_LIMIT)
    expect(new Set(result.sources.map((item) => item.url)).size).toBe(SEARCH_HISTORY_LIMIT)
    expect(result.sources[0]).toMatchObject({
      url: 'https://example.com/23',
      title: 'Updated title',
    })
    expect(result.queries.map((item) => item.query)).toEqual(['launch'])
    await clearSearchHistory.execute({ principal, input })
    expect(await listSearchHistory.execute({ principal, input })).toEqual({
      sources: [],
      queries: [],
    })
  })

  it('excludes expired navigation and rejects executable or credential-bearing URLs', async () => {
    await db.insert(organizationSearchHistory).values({
      ...input,
      userId: principal.userId,
      sources: [{ ...source, viewedAt: '2020-01-01T00:00:00.000Z' }],
      queries: [{ query: 'old query', searchedAt: '2020-01-01T00:00:00.000Z' }],
    })
    expect(await listSearchHistory.execute({ principal, input })).toEqual({
      sources: [],
      queries: [],
    })
    for (const url of ['javascript:alert(1)', 'https://user:secret@example.com']) {
      await expect(
        recordSearchHistory.execute({
          principal,
          input: { ...input, event: { kind: 'source', source: { ...source, url } } },
        })
      ).rejects.toMatchObject({ code: 'validation' })
    }
    await recordSearchHistory.execute({
      principal,
      input: { ...input, event: { kind: 'source', source } },
    })
    const [row] = await db.select().from(organizationSearchHistory).where(scope)
    expect(row.sources).toHaveLength(1)
    expect(row.queries).toEqual([])
  })
})
