/**
 * The counted knowledge-base list must total each base through that base's own documents, never
 * through a set-based join over the whole document table. The reader's ACL tokens are shared by
 * every tenant, so a join the planner drives from the ACL index instead of `knowledge_base_id`
 * reads every tenant's documents to total one base. Nested loops are disabled while planning so
 * the planner reaches for exactly that join wherever the query shape still allows it.
 */
import type { Principal } from '@sim/auth/principal'
import * as schema from '@sim/db/schema'
import { document, organization, user, workspace } from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { withUtcTimestamps } from '@sim/db/timestamps'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({
  current: undefined as PostgresJsDatabase<typeof import('@sim/db/schema')> | undefined,
  /** Every statement the app issues, so the test can EXPLAIN the exact SQL it ran. */
  statements: [] as { sql: string; params: unknown[] }[],
}))
vi.mock('@sim/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/db')>()),
  get db() {
    if (!database.current) throw new Error('Test database not initialized')
    return database.current
  },
}))

import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { listKnowledgeBases } from '@/lib/knowledge/application/knowledge-bases'

interface PlanNode {
  'Node Type': string
  'Relation Name'?: string
  'Index Cond'?: string
  'Recheck Cond'?: string
  Filter?: string
  Plans?: PlanNode[]
}

function documentScans(node: PlanNode): PlanNode[] {
  const own = node['Relation Name'] === 'document' ? [node] : []
  return [...own, ...(node.Plans ?? []).flatMap(documentScans)]
}

const ids = createKnowledgeAclFixtureIds()
const reader: Principal = { kind: 'session', userId: ids.bobId, sessionId: 'fixture-reader' }
const connection = postgres(
  readTestDatabaseUrl(),
  withUtcTimestamps({
    max: 2,
    prepare: false,
    fetch_types: false,
    connection: {},
    onnotice: () => {},
  })
)

describe('knowledge-base list totals plan', () => {
  beforeAll(async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('Unexpected provider request in knowledge-base totals plan test')
    })
    database.current = drizzle(connection, {
      schema,
      logger: {
        logQuery(sql, params) {
          database.statements.push({ sql, params })
        },
      },
    })
    await seedKnowledgeAclFixture(ids, { connectorType: 'google_drive' })
    await database.current.insert(document).values({
      id: generateId(),
      knowledgeBaseId: ids.knowledgeBaseId,
      filename: 'Workspace handbook',
      fileUrl: 'https://fixture.test/shared',
      fileSize: 10,
      mimeType: 'text/plain',
      tokenCount: 10,
      processingStatus: 'completed',
    })
  })

  afterAll(async () => {
    await database.current?.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await database.current?.delete(organization).where(eq(organization.id, ids.organizationId))
    await database.current?.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    await connection.end()
    vi.unstubAllGlobals()
  })

  it('totals each base through its own documents even when the planner prefers a hash join', async () => {
    database.statements.length = 0
    const { knowledgeBases } = await listKnowledgeBases.execute({
      principal: reader,
      input: { workspaceId: ids.workspaceId },
    })
    expect(knowledgeBases.map(({ knowledgeBase }) => knowledgeBase)).toEqual([
      expect.objectContaining({ id: ids.knowledgeBaseId, docCount: 1, tokenCount: 10 }),
    ])

    const counted = database.statements.filter(
      ({ sql }) =>
        /^select .* from "knowledge_base" /.test(sql) &&
        sql.includes('"document"."knowledge_base_id" = "knowledge_base"."id"')
    )
    expect(counted).toHaveLength(1)
    const plan = await connection.begin(async (tx) => {
      await tx`SET LOCAL enable_nestloop = off`
      const [row] = await tx.unsafe(
        `EXPLAIN (FORMAT JSON) ${counted[0].sql}`,
        counted[0].params as Parameters<typeof tx.unsafe>[1]
      )
      return (row['QUERY PLAN'] as { Plan: PlanNode }[])[0].Plan
    })

    const scans = documentScans(plan)
    expect(scans.length).toBeGreaterThan(0)
    for (const scan of scans) {
      const conditions = [scan['Index Cond'], scan['Recheck Cond'], scan.Filter].join(' ')
      expect(conditions, `${scan['Node Type']} on document`).toContain(
        '(knowledge_base_id = knowledge_base.id)'
      )
    }
  })
})
