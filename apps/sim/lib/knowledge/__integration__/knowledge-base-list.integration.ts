import { writeFileSync } from 'node:fs'
import { db } from '@sim/db'
import { document, knowledgeBase, organization, user, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { type KnowledgeAccessScope, WORKSPACE_ACCESS_TOKENS } from '@/lib/knowledge/access/types'
import { getWorkspaceKnowledgeBases } from '@/lib/knowledge/service'

/**
 * A small KB page must not count the rest of its workspace or other tenants before applying
 * its limit. Real query plans catch this even when warm caches hide it from a timing test.
 * The same read must retain ACL/lifecycle filtering, empty bases, and keyset continuity.
 */
const ids = createKnowledgeAclFixtureIds()
const foreign = createKnowledgeAclFixtureIds()
const manyBases = createKnowledgeAclFixtureIds()
const offPageId = generateId()
const emptyId = generateId()
const archivedId = generateId()
const access: KnowledgeAccessScope = { kind: 'workspace', tokens: WORKSPACE_ACCESS_TOKENS }
const reports: Array<Record<string, unknown>> = []

interface CapturedQuery {
  query: string
  parameters: NonNullable<Parameters<typeof db.$client.unsafe>[1]>
}

interface ExplainNode {
  'Relation Name'?: string
  'Index Name'?: string
  'Actual Rows': number
  'Actual Loops': number
  'Rows Removed by Filter'?: number
  'Rows Removed by Index Recheck'?: number
  Plans?: ExplainNode[]
}

function documentVisits(node: ExplainNode): number {
  const readsDocuments =
    node['Relation Name'] === 'document' || node['Index Name']?.startsWith('doc_')
  const own = readsDocuments
    ? (node['Actual Rows'] +
        (node['Rows Removed by Filter'] ?? 0) +
        (node['Rows Removed by Index Recheck'] ?? 0)) *
      node['Actual Loops']
    : 0
  return own + (node.Plans ?? []).reduce((total, child) => total + documentVisits(child), 0)
}

beforeAll(async () => {
  await seedKnowledgeAclFixture(ids, { connectorType: 'google_drive' })
  await seedKnowledgeAclFixture(foreign, { connectorType: 'google_drive' })
  await db
    .update(knowledgeBase)
    .set({ name: 'A small', createdAt: new Date('2026-01-01') })
    .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
  await db.insert(knowledgeBase).values([
    {
      id: emptyId,
      workspaceId: ids.workspaceId,
      userId: ids.aliceId,
      name: 'B empty',
      createdAt: new Date('2026-01-02'),
    },
    {
      id: offPageId,
      workspaceId: ids.workspaceId,
      userId: ids.aliceId,
      name: 'C large',
      createdAt: new Date('2026-01-03'),
    },
    {
      id: archivedId,
      workspaceId: ids.workspaceId,
      userId: ids.aliceId,
      name: 'D archived',
      deletedAt: new Date(),
    },
  ])
  await db.insert(document).values(
    [
      { tokenCount: 7 },
      { tokenCount: 11 },
      { tokenCount: 100, acl: ['u:hidden@fixture.test'] },
      { tokenCount: 100, archivedAt: new Date() },
      { tokenCount: 100, deletedAt: new Date() },
      { tokenCount: 100, userExcluded: true },
    ].map((row) => ({
      id: generateId(),
      knowledgeBaseId: ids.knowledgeBaseId,
      filename: 'fixture.txt',
      fileUrl: 'https://fixture.invalid/document',
      fileSize: 1,
      mimeType: 'text/plain',
      acl: ['ws'],
      ...row,
    }))
  )
  for (const baseId of [offPageId, foreign.knowledgeBaseId]) {
    await db.execute(sql`INSERT INTO document
      (id, knowledge_base_id, filename, file_url, file_size, mime_type, acl, token_count)
      SELECT ${baseId} || '-' || n, ${baseId}, 'bulk.txt', 'https://fixture.invalid/bulk',
        1, 'text/plain', ARRAY['ws'], 1 FROM generate_series(1, 10000) AS n`)
  }
  await seedKnowledgeAclFixture(manyBases, { connectorType: 'google_drive' })
  await db.execute(sql`INSERT INTO knowledge_base (id, workspace_id, user_id, name)
    SELECT ${manyBases.knowledgeBaseId} || '-' || n, ${manyBases.workspaceId},
      ${manyBases.aliceId}, 'Scale fixture ' || n FROM generate_series(1, 10000) AS n`)
  await db.execute(sql`INSERT INTO document
    (id, knowledge_base_id, filename, file_url, file_size, mime_type, acl, token_count)
    VALUES (${generateId()}, ${manyBases.knowledgeBaseId}, 'first.txt',
      'https://fixture.invalid/first', 1, 'text/plain', ARRAY['ws'], 13),
      (${generateId()}, ${`${manyBases.knowledgeBaseId}-10000`}, 'last.txt',
      'https://fixture.invalid/last', 1, 'text/plain', ARRAY['ws'], 17)`)
  await db.execute(sql`ANALYZE knowledge_base`)
  await db.execute(sql`ANALYZE document`)
}, 60_000)

afterAll(async () => {
  const reportPath = process.env.KNOWLEDGE_BASE_LIST_REPORT_PATH
  if (reportPath) writeFileSync(reportPath, JSON.stringify(reports, null, 2))
  try {
    for (const fixture of [ids, foreign, manyBases]) {
      await db.delete(workspace).where(eq(workspace.id, fixture.workspaceId))
      await db.delete(organization).where(eq(organization.id, fixture.organizationId))
      await db.delete(user).where(inArray(user.id, [fixture.aliceId, fixture.bobId]))
    }
  } finally {
    await db.$client.end()
  }
})

describe('knowledge base list counts on real Postgres', () => {
  it.each(['name', 'createdAt'] as const)(
    'bounds document reads to a small page ordered by %s',
    async (sortBy) => {
      const captured: CapturedQuery[] = []
      const previousDebug = db.$client.options.debug
      db.$client.options.debug = (_connection, query, parameters) => {
        if (captured.length < 30) captured.push({ query, parameters: [...parameters] })
      }
      try {
        const page = await getWorkspaceKnowledgeBases(ids.workspaceId, 'active', {
          countsFor: access,
          limit: 1,
          sortBy,
        })
        expect(
          page.data.map(({ id, docCount, tokenCount }) => ({ id, docCount, tokenCount }))
        ).toEqual([{ id: ids.knowledgeBaseId, docCount: 2, tokenCount: 18 }])
        expect(page.nextCursorKeys).not.toBeNull()
      } finally {
        db.$client.options.debug = previousDebug
      }
      const plans = []
      for (const statement of captured.filter(({ query }) => query.includes('"document"'))) {
        const [result] = await db.$client.unsafe<
          Array<{ 'QUERY PLAN': Array<{ Plan: ExplainNode }> }>
        >(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.query}`, statement.parameters)
        plans.push(...result['QUERY PLAN'])
      }
      const visits = plans.reduce((total, plan) => total + documentVisits(plan.Plan), 0)
      reports.push({ sortBy, visits, plans })
      expect(plans.length).toBeGreaterThan(0)
      expect(visits).toBeLessThan(100)
    }
  )

  it('keeps empty KBs and count visibility through pagination and unpaged reads', async () => {
    const first = await getWorkspaceKnowledgeBases(ids.workspaceId, 'active', {
      countsFor: access,
      limit: 1,
      sortBy: 'name',
    })
    if (!first.nextCursorKeys) throw new Error('Expected a second knowledge-base page')
    const second = await getWorkspaceKnowledgeBases(ids.workspaceId, 'active', {
      countsFor: access,
      limit: 1,
      sortBy: 'name',
      cursorKeys: first.nextCursorKeys,
    })
    expect(
      second.data.map(({ id, docCount, tokenCount }) => ({ id, docCount, tokenCount }))
    ).toEqual([{ id: emptyId, docCount: 0, tokenCount: 0 }])
    const all = await getWorkspaceKnowledgeBases(ids.workspaceId, 'active', {
      countsFor: access,
      sortBy: 'name',
    })
    expect(all.data.map(({ id, docCount, tokenCount }) => ({ id, docCount, tokenCount }))).toEqual([
      { id: ids.knowledgeBaseId, docCount: 2, tokenCount: 18 },
      { id: emptyId, docCount: 0, tokenCount: 0 },
      { id: offPageId, docCount: 10000, tokenCount: 10000 },
    ])
    expect(all.nextCursorKeys).toBeNull()
    const archived = await getWorkspaceKnowledgeBases(ids.workspaceId, 'archived', {
      countsFor: access,
    })
    expect(archived.data.map(({ id }) => id)).toEqual([archivedId])
  })

  it('counts a large unpaged workspace within a fixed database round-trip budget', async () => {
    let documentQueries = 0
    const previousDebug = db.$client.options.debug
    db.$client.options.debug = (_connection, query) => {
      if (query.includes('"document"')) documentQueries++
    }
    try {
      const all = await getWorkspaceKnowledgeBases(manyBases.workspaceId, 'active', {
        countsFor: access,
      })
      expect(all.data).toHaveLength(10001)
      expect(all.nextCursorKeys).toBeNull()
      expect(all.data.find((kb) => kb.id === manyBases.knowledgeBaseId)).toMatchObject({
        docCount: 1,
        tokenCount: 13,
      })
      expect(all.data.find((kb) => kb.id === `${manyBases.knowledgeBaseId}-10000`)).toMatchObject({
        docCount: 1,
        tokenCount: 17,
      })
      expect(all.data.reduce((total, kb) => total + kb.docCount, 0)).toBe(2)
      expect(all.data.reduce((total, kb) => total + kb.tokenCount, 0)).toBe(30)
      reports.push({ unpagedBases: all.data.length, documentQueries })
      expect(documentQueries).toBeGreaterThan(0)
      expect(documentQueries).toBeLessThan(10)
    } finally {
      db.$client.options.debug = previousDebug
    }
  })
})
