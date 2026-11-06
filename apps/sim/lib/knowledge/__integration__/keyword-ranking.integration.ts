/**
 * The keyword leg of a search with no signed-in reader behind it, against real PostgreSQL: it
 * answers what ranking each base (or all of them) in the two-step pass does, tie groups compared
 * as sets, and admits nothing the reader may not see.
 *
 * Every chunk's vector points away from the query vector, so the vector leg of a hybrid search
 * finds nothing under its distance threshold and the fused list is the keyword ranking alone.
 */
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { document, embedding, knowledgeBase, organization, user, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { confluencePageAcl } from '@/lib/knowledge/access/confluence-permissions'
import { knowledgeAccessCondition } from '@/lib/knowledge/access/predicate'
import { resolveKnowledgeAccessScope } from '@/lib/knowledge/access/scope'
import type { KnowledgeAccessScope } from '@/lib/knowledge/access/types'
import { FTS_CONFIG, getVisibilityConditions } from '@/lib/knowledge/search/candidates'
import { retrieveKnowledgeSearch } from '@/lib/knowledge/search/queries'
import { embeddingVectorValues } from '@/lib/knowledge/vector-columns'

const DIMENSIONS = 1536
const QUERY = 'orion'
const queryVector = {
  vector: JSON.stringify([1, ...Array<number>(DIMENSIONS - 1).fill(0)]),
  dimensions: DIMENSIONS,
  model: 'text-embedding-3-small',
} as const
const AWAY_FROM_QUERY = [-1, ...Array<number>(DIMENSIONS - 1).fill(0)]

/** More bases than the pass ranks in one statement, so it takes its per-base branch. */
const EXTRA_BASE_COUNT = 5
const DOCUMENTS_PER_BASE = 3
const CHUNKS_PER_DOCUMENT = 2
/** Hidden documents outrank every visible one, so admitting any of them would surface it first. */
const HIDDEN_OCCURRENCES = 9

type HiddenKind =
  | 'excluded'
  | 'deleted'
  | 'archived'
  | 'disabled-document'
  | 'disabled-chunk'
  | 'pending'
  | 'missing-group'
  | 'stale-source'
  | 'unsearched-base'
  | 'restricted-source'
  | 'user-only'

/** Hidden from every reader. */
const HIDDEN_FROM_ALL: HiddenKind[] = [
  'excluded',
  'deleted',
  'archived',
  'disabled-document',
  'disabled-chunk',
  'pending',
  'missing-group',
  'stale-source',
  'unsearched-base',
]
/** Readable to the signed-in owner of the source groups, never to a workspace key. */
const HIDDEN_FROM_WORKSPACE_KEY: HiddenKind[] = [
  ...HIDDEN_FROM_ALL,
  'restricted-source',
  'user-only',
]

interface RankedKeywordRow {
  id: string
  keywordRank: number
}

/** The two-step unauthenticated keyword ranking: the oracle each case is compared against. */
async function rankTwoStep(input: {
  knowledgeBaseIds: string[]
  topK: number
  query: string
  access: KnowledgeAccessScope
}): Promise<RankedKeywordRow[]> {
  const { knowledgeBaseIds, topK, query } = input
  const tsQuery = sql`websearch_to_tsquery(${FTS_CONFIG}, ${query})`
  const tagFilterConditions: SQL[] = []
  const rankExpr = sql<number>`ts_rank_cd(${embedding.contentTsv}, ${tsQuery})`
  const visibility = getVisibilityConditions(undefined, knowledgeAccessCondition(input.access))
  const rankRows = (kbScope: SQL) =>
    db
      .select({ id: embedding.id, keywordRank: rankExpr.as('keyword_rank') })
      .from(embedding)
      .innerJoin(document, eq(embedding.documentId, document.id))
      .where(
        and(
          kbScope,
          ...visibility,
          sql`${embedding.contentTsv} @@ ${tsQuery}`,
          ...tagFilterConditions
        )
      )
      .orderBy(sql`${rankExpr} DESC`)
      .limit(topK)

  const kbCount = knowledgeBaseIds.length
  const useParallel = kbCount > 4 || (kbCount > 2 && topK > 50)
  if (useParallel) {
    const perBase = await Promise.all(
      knowledgeBaseIds.map((kbId) => rankRows(eq(embedding.knowledgeBaseId, kbId)))
    )
    return perBase
      .flat()
      .sort((a, b) => b.keywordRank - a.keywordRank)
      .slice(0, topK)
  }
  return rankRows(inArray(embedding.knowledgeBaseId, knowledgeBaseIds))
}

/** Candidates the hybrid keyword leg ranks before the fused list is trimmed to `topK`. */
function hybridLegTopK(topK: number) {
  return Math.min(Math.max(topK * 3, 50), 200)
}

/**
 * Asserts `actual` is the reference ranking's head: distinct scores in the same order, each tie
 * group holding the same members (only the group the cut falls in may hold a subset).
 */
function expectSameRanking(actual: string[], reference: RankedKeywordRow[], topK: number) {
  expect(new Set(actual).size).toBe(actual.length)
  expect(actual).toHaveLength(Math.min(topK, reference.length))
  let cursor = 0
  let groupStart = 0
  while (cursor < actual.length && groupStart < reference.length) {
    const score = reference[groupStart].keywordRank
    let groupEnd = groupStart
    while (groupEnd < reference.length && reference[groupEnd].keywordRank === score) groupEnd++
    const group = new Set(reference.slice(groupStart, groupEnd).map((row) => row.id))
    const taken = actual.slice(cursor, cursor + group.size)
    for (const id of taken) {
      expect(group.has(id), `${id} belongs to the tie group scored ${score}`).toBe(true)
    }
    cursor += taken.length
    groupStart = groupEnd
  }
  expect(cursor).toBe(actual.length)
}

describe('unauthenticated keyword ranking', () => {
  const ids = createKnowledgeAclFixtureIds()
  const extraBaseIds = Array.from({ length: EXTRA_BASE_COUNT }, () => generateId())
  const unsearchedBaseId = generateId()
  const allBaseIds = [ids.knowledgeBaseId, ...extraBaseIds]
  const hiddenChunkIds = new Map<HiddenKind, string>()
  const workspaceKey: Principal = {
    kind: 'workspace_api_key',
    workspaceId: ids.workspaceId,
    keyId: 'fixture-key',
  }
  const alice: Principal = { kind: 'session', userId: ids.aliceId, sessionId: 'fixture-alice' }
  const restrictedAcl = confluencePageAcl({
    providerId: 'google-drive',
    tenantId: 'fixture-tenant',
    spacePrincipals: [{ kind: 'group', id: 'space' }],
    restrictionChain: [[{ kind: 'group', id: 'parent' }], [{ kind: 'group', id: 'page' }]],
  })

  function chunkValues(input: {
    documentId: string
    knowledgeBaseId: string
    chunkIndex: number
    occurrences: number
    enabled?: boolean
  }) {
    const id = generateId()
    const content = `${Array<string>(input.occurrences).fill(QUERY).join(' ')} survey notes`
    return {
      id,
      documentId: input.documentId,
      knowledgeBaseId: input.knowledgeBaseId,
      chunkIndex: input.chunkIndex,
      chunkHash: id,
      content,
      contentLength: content.length,
      tokenCount: input.occurrences + 2,
      startOffset: 0,
      endOffset: content.length,
      enabled: input.enabled ?? true,
      ...embeddingVectorValues(DIMENSIONS, AWAY_FROM_QUERY),
    }
  }

  function documentValues(documentId: string, knowledgeBaseId: string) {
    return {
      id: documentId,
      knowledgeBaseId,
      filename: `${documentId}.txt`,
      fileUrl: `https://fixture.invalid/${documentId}`,
      fileSize: 12,
      mimeType: 'text/plain',
      processingStatus: 'completed',
      acl: ['ws'],
    }
  }

  beforeAll(async () => {
    await seedKnowledgeAclFixture(ids, { connectorType: 'google_drive' })
    await db.insert(knowledgeBase).values(
      [...extraBaseIds, unsearchedBaseId].map((id, index) => ({
        id,
        userId: ids.aliceId,
        workspaceId: ids.workspaceId,
        name: `Keyword ranking fixture ${index}`,
      }))
    )

    const documents: ReturnType<typeof documentValues>[] = []
    const chunks: ReturnType<typeof chunkValues>[] = []
    /** Occurrence counts repeat across bases and documents, so equal scores span bases. */
    allBaseIds.forEach((knowledgeBaseId, baseIndex) => {
      for (let documentIndex = 0; documentIndex < DOCUMENTS_PER_BASE; documentIndex++) {
        const documentId = generateId()
        documents.push(documentValues(documentId, knowledgeBaseId))
        for (let chunkIndex = 0; chunkIndex < CHUNKS_PER_DOCUMENT; chunkIndex++) {
          chunks.push(
            chunkValues({
              documentId,
              knowledgeBaseId,
              chunkIndex,
              occurrences: 1 + ((baseIndex + documentIndex + chunkIndex) % 4),
            })
          )
        }
        chunks.push(
          chunkValues({
            documentId,
            knowledgeBaseId,
            chunkIndex: CHUNKS_PER_DOCUMENT,
            occurrences: 0,
          })
        )
      }
    })

    const hidden: Array<{
      kind: HiddenKind
      document: Partial<typeof document.$inferInsert>
      chunkEnabled?: boolean
    }> = [
      { kind: 'excluded', document: { userExcluded: true } },
      { kind: 'deleted', document: { deletedAt: new Date() } },
      { kind: 'archived', document: { archivedAt: new Date() } },
      { kind: 'disabled-document', document: { enabled: false } },
      { kind: 'disabled-chunk', document: {}, chunkEnabled: false },
      { kind: 'pending', document: { processingStatus: 'pending' } },
      {
        kind: 'missing-group',
        document: {
          connectorId: ids.connectorId,
          acl: ['g:google-drive:fixture-tenant:missing'],
          aclVerifiedAt: new Date(),
        },
      },
      {
        kind: 'stale-source',
        document: {
          connectorId: ids.connectorId,
          acl: [...restrictedAcl.acl],
          aclRequirements: restrictedAcl.requirements.map((clause) => [...clause]),
          aclVerifiedAt: new Date(0),
        },
      },
      { kind: 'unsearched-base', document: {} },
      {
        kind: 'restricted-source',
        document: {
          connectorId: ids.connectorId,
          acl: [...restrictedAcl.acl],
          aclRequirements: restrictedAcl.requirements.map((clause) => [...clause]),
          aclVerifiedAt: new Date(),
        },
      },
      { kind: 'user-only', document: { acl: [`u:${ids.aliceId}@fixture.test`] } },
    ]
    const hiddenDocuments: (typeof document.$inferInsert)[] = []
    for (const entry of hidden) {
      const documentId = generateId()
      const knowledgeBaseId =
        entry.kind === 'unsearched-base' ? unsearchedBaseId : ids.knowledgeBaseId
      hiddenDocuments.push({ ...documentValues(documentId, knowledgeBaseId), ...entry.document })
      const chunk = chunkValues({
        documentId,
        knowledgeBaseId,
        chunkIndex: 0,
        occurrences: HIDDEN_OCCURRENCES,
        enabled: entry.chunkEnabled,
      })
      hiddenChunkIds.set(entry.kind, chunk.id)
      chunks.push(chunk)
    }

    await db.insert(document).values([...documents, ...hiddenDocuments])
    await db.insert(embedding).values(chunks)

    // The comparisons below test tie-breaking only if scores tie across bases at several levels.
    const scores = await db
      .select({
        rank: sql<number>`ts_rank_cd(${embedding.contentTsv}, websearch_to_tsquery(${FTS_CONFIG}, ${QUERY}))`,
        bases: sql<number>`count(DISTINCT ${embedding.knowledgeBaseId})::int`,
      })
      .from(embedding)
      .where(
        and(
          inArray(embedding.knowledgeBaseId, allBaseIds),
          sql`${embedding.contentTsv} @@ websearch_to_tsquery(${FTS_CONFIG}, ${QUERY})`
        )
      )
      .groupBy(sql`1`)
    expect(scores.length).toBeGreaterThan(2)
    expect(scores.filter((score) => score.bases > 1).length).toBeGreaterThan(1)
  })

  afterAll(async () => {
    await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    await db.$client.end()
  })

  async function compare(input: {
    principal: Principal
    knowledgeBaseIds: string[]
    topK: number
    hiddenKinds: HiddenKind[]
  }) {
    const access = await resolveKnowledgeAccessScope(input.principal, {
      workspaceId: ids.workspaceId,
    })
    const { rows, retrieval } = await retrieveKnowledgeSearch({
      knowledgeBaseIds: input.knowledgeBaseIds,
      topK: input.topK,
      access,
      searchMode: 'hybrid',
      query: QUERY,
      queryVector,
    })
    expect(retrieval).toEqual({ status: 'complete', timedOutLegs: [] })
    const reference = await rankTwoStep({
      knowledgeBaseIds: input.knowledgeBaseIds,
      topK: hybridLegTopK(input.topK),
      query: QUERY,
      access,
    })
    const actual = rows.map((row) => row.id)
    expectSameRanking(actual, reference, input.topK)

    const hiddenIds = input.hiddenKinds.map((kind) => hiddenChunkIds.get(kind))
    expect(hiddenIds.every((id) => typeof id === 'string')).toBe(true)
    for (const id of hiddenIds) {
      expect(actual).not.toContain(id)
      expect(reference.map((row) => row.id)).not.toContain(id)
    }
    return { actual, reference }
  }

  describe.each([
    { label: 'every base (per-base branch)', baseCount: allBaseIds.length },
    { label: 'two bases (single-statement branch)', baseCount: 2 },
  ])('$label', ({ baseCount }) => {
    const knowledgeBaseIds = allBaseIds.slice(0, baseCount)

    it.each([5, 12, 40])(
      'matches the two-step ranking for a workspace key at topK %i',
      async (topK) => {
        await compare({
          principal: workspaceKey,
          knowledgeBaseIds,
          topK,
          hiddenKinds: HIDDEN_FROM_WORKSPACE_KEY,
        })
      }
    )

    it.each([5, 12, 40])(
      'matches the two-step ranking for a session reader without an access provider at topK %i',
      async (topK) => {
        await compare({
          principal: alice,
          knowledgeBaseIds,
          topK,
          hiddenKinds: HIDDEN_FROM_ALL,
        })
      }
    )
  })

  it('ranks a source document only for the reader its groups admit', async () => {
    const restrictedId = hiddenChunkIds.get('restricted-source')
    const { actual } = await compare({
      principal: alice,
      knowledgeBaseIds: allBaseIds,
      topK: 5,
      hiddenKinds: HIDDEN_FROM_ALL,
    })
    expect(actual).toContain(restrictedId)
  })
})
