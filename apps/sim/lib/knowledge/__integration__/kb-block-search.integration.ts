/** KB block retrieval against disposable PostgreSQL, using a workspace API-key identity. */
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { document, embedding, knowledgeBase, organization, user, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { createKnowledgeAccessProvider } from '@/lib/knowledge/access/scope'
import { retrieveKnowledgeSearch } from '@/lib/knowledge/search/queries'
import { embeddingVectorValues } from '@/lib/knowledge/vector-columns'

describe('API-key KB block fan-out', () => {
  const ids = createKnowledgeAclFixtureIds()
  const bases = Array.from({ length: 18 }, () => ({
    id: generateId(),
    visible: generateId(),
    denied: generateId(),
    excluded: generateId(),
  }))
  const principal: Principal = {
    kind: 'workspace_api_key',
    workspaceId: ids.workspaceId,
    keyId: 'fixture-key',
  }
  const vector = [1, ...Array<number>(1535).fill(0)]
  const queryVector = {
    vector: JSON.stringify(vector),
    dimensions: 1536 as const,
    model: 'text-embedding-3-small',
  }

  beforeAll(async () => {
    await seedKnowledgeAclFixture(ids, { connectorType: 'google_drive' })
    await db.insert(knowledgeBase).values(
      bases.map((base, index) => ({
        id: base.id,
        userId: ids.aliceId,
        workspaceId: ids.workspaceId,
        name: `KB block ${index}`,
      }))
    )
    await db.insert(document).values(
      bases.flatMap((base) =>
        (['visible', 'denied', 'excluded'] as const).map((kind) => ({
          id: base[kind],
          knowledgeBaseId: base.id,
          filename: kind,
          fileUrl: `https://fixture.invalid/${base[kind]}`,
          fileSize: 12,
          mimeType: 'text/plain',
          processingStatus: 'completed',
          acl: kind === 'denied' ? [`u:${ids.aliceId}@fixture.test`] : ['ws'],
          userExcluded: kind === 'excluded',
        }))
      )
    )
    await db.insert(embedding).values(
      bases.flatMap((base) =>
        (['visible', 'denied', 'excluded'] as const).map((kind) => ({
          id: generateId(),
          documentId: base[kind],
          knowledgeBaseId: base.id,
          chunkIndex: 0,
          chunkHash: base[kind],
          content: `Fixture policy ${kind}`,
          contentLength: 24,
          tokenCount: 5,
          startOffset: 0,
          endOffset: 24,
          tag1: 'policy',
          ...embeddingVectorValues(1536, vector),
        }))
      )
    )
  })

  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    await db.$client.end()
  })

  it.each([false, true])(
    'completes 18 concurrent KB searches with access checks intact (tag filter: %s)',
    async (withTags) => {
      const previousDebug = db.$client.options.debug
      const statements: string[] = []
      db.$client.options.debug = (_connection, query) => {
        if (statements.length < 250) statements.push(query)
      }
      try {
        const results = await Promise.all(
          bases.map(async (base) => {
            const accessProvider = createKnowledgeAccessProvider(principal, {
              workspaceId: ids.workspaceId,
              knowledgeBaseIds: [base.id],
            })
            const access = await accessProvider.get()
            expect(access.kind).toBe('workspace')
            return retrieveKnowledgeSearch({
              knowledgeBaseIds: [base.id],
              topK: 2,
              access,
              accessProvider,
              searchMode: 'vector',
              query: 'Find the fixture policy',
              queryVector,
              ...(withTags && {
                structuredFilters: [
                  { tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'policy' },
                ],
              }),
            })
          })
        )
        for (const [index, result] of results.entries()) {
          expect(result.retrieval).toEqual({ status: 'complete', timedOutLegs: [] })
          expect(result.rows.map((row) => row.documentId)).toEqual([bases[index].visible])
          expect(result.rows[0].knowledgeBaseId).toBe(bases[index].id)
          expect(result.rows[0].distance).toBeCloseTo(0)
        }
        expect(statements.filter((query) => query.includes('statement_timeout'))).toHaveLength(36)
        expect(statements.filter((query) => query.includes('+ 0'))).toHaveLength(18)
        expect(statements.some((query) => query.includes('hnsw.iterative_scan'))).toBe(false)
      } finally {
        db.$client.options.debug = previousDebug
      }
    }
  )
})
