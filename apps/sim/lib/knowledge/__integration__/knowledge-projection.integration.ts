/**
 * The knowledge projector and the readers that must stay correct while it lags. A GitHub member
 * source's document in a search index is changed by a writer in either projection mode —
 * synchronous, as every writer now is, or deferred, as writers of earlier releases could be,
 * leaving only a mark — and search is checked before the
 * projector runs: a revoked member is refused and a granted one is served, on the vector and
 * keyword legs and under the source filter, and a disabled or deleted chunk is gone at once. The
 * projector's own contract follows: it converges the rows and removes the mark, keeps a mark that
 * a write bumped during its pass, survives a document deleted under it, writes in pages bounded by
 * chunk rows, releases workspace marks with nothing to project without a pass, and a deferred
 * commit writes no projection row at all.
 */
import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import {
  hasKnowledgeProjectionWork,
  type KnowledgeProjection,
  releaseSettledMarks,
  runKnowledgeProjection,
} from '@sim/db/knowledge-projection'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  document,
  embedding,
  embeddingKeywordTin,
  embeddingSearch,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeDocumentObservation,
  knowledgeProjectionDirty,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/** This suite covers indexed organization search, which is dormant unless Live Search is off. */
vi.mock('@/lib/core/config/env-flags', async (importOriginal) =>
  (await import('@sim/testing/mocks/indexed-org-search.mock')).indexedOrgSearchEnvFlags(
    importOriginal
  )
)
/** The TINQL `resolveTinKeywordQuery` renders for `fixture`: its `english` stem, quoted. */
vi.mock('@/lib/sim-search/indexed/retrieval/tin-keyword', () => ({
  resolveTinKeywordQuery: async () => '"fixtur"',
}))

vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: async () => false }))

import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import type {
  GitHubInstallationReadGrant,
  KnowledgeAccessProvider,
  UserAccessScope,
} from '@/lib/knowledge/access/types'
import { leaseTransaction } from '@/lib/knowledge/connectors/sync-lock'
import { liveSourceAccessForConnectors } from '@/lib/knowledge/search/candidates'
import { GITHUB_INSTALLATION_PROVIDER_ID } from '@/lib/oauth/github-installation-types'
import type { SearchAccessPlan } from '@/lib/sim-search/indexed/retrieval/access-plan'
import { executeIndexedKeywordSearch } from '@/lib/sim-search/indexed/retrieval/keyword'
import type { IndexedRetrievalContext } from '@/lib/sim-search/indexed/retrieval/permitted'
import { projectionCandidateAccessCondition } from '@/lib/sim-search/indexed/retrieval/projection-access'
import { forgetProjectionFilled } from '@/lib/sim-search/indexed/retrieval/projection-fill'
import { selectIndexedVectorResults } from '@/lib/sim-search/indexed/retrieval/vector'

const ids = createKnowledgeAclFixtureIds()
const connectorId = generateId()
const otherConnectorId = generateId()
const contentCredentialId = generateId()
const groupId = generateId()
const optionId = generateId()
const documentId = generateId()
const chunkId = generateId()
const repositoryId = '4242'
const members = {
  alice: { id: generateId(), subject: 'alice-gh', credentialId: generateId() },
  bob: { id: generateId(), subject: 'bob-gh', credentialId: generateId() },
}
const subjectToken = (subject: string) => `s:github-repositories:-:${subject}`
const aclOf = (...who: Array<'alice' | 'bob'>) =>
  who.map((name) => subjectToken(members[name].subject)).sort()
/**
 * A direction no other integration file writes, so no row of theirs ties with this file's chunks.
 * Inside the first 512 dimensions, the only ones the candidate projection keeps.
 */
const vector = Array.from({ length: 1536 }, (_, index) => (index === 511 ? 1 : 0))
const queryVector = {
  vector: JSON.stringify(vector),
  dimensions: 1536 as const,
  model: 'text-embedding-3-small',
}

/** Alice holds the installation grant, so what she reads is decided by the document's ACL alone. */
const scope: UserAccessScope = {
  kind: 'user',
  userId: ids.aliceId,
  tokens: [
    'pub',
    subjectToken(members.alice.subject),
    `u:${ids.aliceId}@fixture.test`,
    'ws',
  ].sort(),
}
const plan: SearchAccessPlan = {
  connectors: {
    workspace: [],
    admin: [],
    members: [connectorId],
    liveProofRequired: [connectorId],
  },
  observers: { confirmed: [{ id: members.alice.id, connectorId }], observed: [] },
  memberSources: [connectorId],
  connectorTypes: new Map([[connectorId, 'github']]),
  uploads: false,
}
const grant: GitHubInstallationReadGrant = {
  connectorId,
  contentCredentialId,
  readerCredentialId: members.alice.credentialId,
  readerSubjectToken: subjectToken(members.alice.subject),
  repositoryId,
}

const searchInputs = {
  knowledgeBaseIds: [ids.knowledgeBaseId],
  topK: 20,
  access: scope,
  queryVector,
}

/** A narrow reader of the search index, who proves the installation grant live. */
function searchContext(): IndexedRetrievalContext {
  const granted = { ...scope, githubInstallationGrants: [grant] }
  const accessProvider: KnowledgeAccessProvider = {
    get: async () => scope,
    getForConnectors: async () => granted,
    getForDocuments: async () => granted,
    liveSourceConnectorCondition: async () => null,
  }
  return {
    access: scope,
    accessPlan: plan,
    filtered: false,
    permitted: { kind: 'unbounded', broad: false },
    liveSourceAccess: liveSourceAccessForConnectors(
      plan.connectors.liveProofRequired,
      accessProvider
    ),
  }
}

const keywordIds = async () =>
  (await executeIndexedKeywordSearch({ ...searchInputs, query: 'fixture' }, searchContext()))
    .map((row) => row.id)
    .sort()

/**
 * Ranked exactly on the row, under the same visibility predicate the graph walk applies. The walk
 * is approximate: in a graph the other files sharing this database crowd with degenerate vectors,
 * a chunk can be pruned from every neighbour list and never be reached, however far the walk goes.
 */
const vectorIds = async () =>
  (await selectIndexedVectorResults({ ...searchInputs, distanceThreshold: 2 }, searchContext()))
    .map((row) => row.id)
    .sort()

/** The chunks of the fixture document each ranking projection admits for Alice. */
async function admitted(): Promise<Record<'vector' | 'keyword', string[]>> {
  const [vectorRows, keywordRows] = await Promise.all([
    db
      .select({ id: embeddingSearch.id })
      .from(embeddingSearch)
      .where(
        and(
          eq(embeddingSearch.documentId, documentId),
          projectionCandidateAccessCondition(embeddingSearch, scope, plan, { filled: true })
        )
      ),
    db
      .select({ id: embeddingKeywordTin.id })
      .from(embeddingKeywordTin)
      .where(
        and(
          eq(embeddingKeywordTin.documentId, documentId),
          projectionCandidateAccessCondition(embeddingKeywordTin, scope, plan, { filled: true })
        )
      ),
  ])
  return {
    vector: vectorRows.map((row) => row.id).sort(),
    keyword: keywordRows.map((row) => row.id).sort(),
  }
}

type Mode = 'sync' | 'async'

/**
 * What a writer of a release that deferred its projection selected first: the setting that skips
 * the synchronous projection triggers, which the database still honours.
 */
const DEFER_PROJECTION = `SELECT set_config('sim.projection_mode', 'async', true)`

/** Runs a write in a transaction of the given projection mode, as a knowledge writer would. */
function write(
  mode: Mode,
  work: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<unknown>
) {
  return db.transaction(async (tx) => {
    if (mode === 'async') await tx.execute(sql.raw(DEFER_PROJECTION))
    await work(tx)
  })
}

function chunkRow(id: string, chunkIndex: number) {
  return {
    id,
    documentId,
    knowledgeBaseId: ids.knowledgeBaseId,
    chunkIndex,
    chunkHash: `fixture-hash-${chunkIndex}`,
    content: 'fixture readme',
    contentLength: 14,
    tokenCount: 2,
    startOffset: 0,
    endOffset: 14,
    embeddingModel: 'text-embedding-3-small',
    embedding: vector,
  }
}

const markOf = async () => {
  const [row] = await db
    .select()
    .from(knowledgeProjectionDirty)
    .where(eq(knowledgeProjectionDirty.documentId, documentId))
  return row
}

const rowAcl = async (table: typeof embeddingSearch | typeof embeddingKeywordTin, id = chunkId) => {
  const [row] = await db
    .select({ acl: table.acl, connectorId: table.connectorId, enabled: table.enabled })
    .from(table)
    .where(eq(table.id, id))
  return row
}

/** The projector's connection: a pass holds its per-document advisory locks on it. */
let projector: postgres.Sql
const project = (options: Partial<Parameters<typeof runKnowledgeProjection>[1]> = {}) =>
  runKnowledgeProjection(projector, { searchIndexes: true, ...options })

/** Shims for the Tin extension, which the test database does not carry. */
let createdTinShims = false

beforeAll(async () => {
  projector = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => undefined })
  await seedKnowledgeAclFixture(ids)
  const now = new Date()
  await db
    .update(knowledgeBase)
    .set({ isSearchIndex: true })
    .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
  await db.insert(credential).values({
    id: contentCredentialId,
    workspaceId: ids.workspaceId,
    type: 'service_account',
    displayName: 'Fixture GitHub installation',
    createdBy: ids.aliceId,
    providerId: GITHUB_INSTALLATION_PROVIDER_ID,
  })
  await db.insert(credentialGroup).values({
    id: groupId,
    workspaceId: ids.workspaceId,
    publicId: generateId(),
    name: 'GitHub readers',
    options: [
      {
        id: optionId,
        provider: 'github-repositories',
        label: 'GitHub fixture',
        authorizationAppId: 'fixture-app',
        requiredScopes: ['repo'],
        scopeVersion: 1,
        required: false,
        status: 'active',
      },
    ],
  } as typeof credentialGroup.$inferInsert)
  for (const who of ['alice', 'bob'] as const) {
    const userId = who === 'alice' ? ids.aliceId : ids.bobId
    const [enrollment] = await db
      .insert(credentialGroupEnrollment)
      .values({
        id: generateId(),
        credentialGroupId: groupId,
        userId,
        email: `${userId}@fixture.test`,
        status: 'completed',
        invitationTokenHash: createHash('sha256').update(generateId()).digest('hex'),
        invitationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        invitedAt: now,
      })
      .returning({ id: credentialGroupEnrollment.id })
    await db.insert(credential).values({
      id: members[who].credentialId,
      workspaceId: ids.workspaceId,
      type: 'managed_oauth',
      displayName: 'Fixture GitHub reader',
      providerId: 'github-repositories',
      authorizationAppId: 'fixture-app',
      credentialGroupEnrollmentId: enrollment!.id,
      credentialGroupOptionId: optionId,
      managedOauthScopeVersion: 1,
      providerSubjectId: members[who].subject,
      providerTenantId: '',
      managedOauthStatus: 'active',
      grantedScopes: ['repo'],
      encryptedOauthTokenSet: 'fixture-not-an-oauth-token',
      grantedAt: now,
      createdBy: userId,
    })
  }
  await db.insert(knowledgeConnector).values(
    [connectorId, otherConnectorId].map((id) => ({
      id,
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorType: 'github',
      sourceConfig: { githubRepositoryId: repositoryId },
      accessMode: 'members',
      status: 'active',
      credentialId: contentCredentialId,
      credentialGroupId: groupId,
      credentialGroupOptionId: optionId,
    }))
  )
  await db.insert(knowledgeConnectorMember).values(
    (['alice', 'bob'] as const).map((who) => ({
      id: members[who].id,
      workspaceId: ids.workspaceId,
      connectorId,
      credentialId: members[who].credentialId,
      subjectToken: subjectToken(members[who].subject),
      status: 'active',
      memberSyncedThrough: now,
    }))
  )
  await db.insert(document).values({
    id: documentId,
    connectorId,
    knowledgeBaseId: ids.knowledgeBaseId,
    externalId: 'fixture-file',
    filename: 'readme.md',
    fileUrl: 'https://fixture.test/readme',
    fileSize: 12,
    mimeType: 'text/plain',
    processingStatus: 'completed',
    acl: aclOf('alice', 'bob'),
  })
  await db.insert(knowledgeDocumentObservation).values(
    (['alice', 'bob'] as const).map((who) => ({
      documentId,
      memberId: members[who].id,
      lastSeenAt: now,
      runId: generateId(),
    }))
  )
  const [tin] = await db.execute<{ present: boolean }>(
    sql`SELECT to_regnamespace('tin') IS NOT NULL AS present`
  )
  if (!tin?.present) {
    createdTinShims = true
    await db.execute(
      sql.raw(`CREATE SCHEMA tin;
      CREATE FUNCTION tin.full_score(tid) RETURNS double precision LANGUAGE sql IMMUTABLE AS 'SELECT 1.0::float8';
      CREATE FUNCTION knowledge_tin_base_token(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT 'kb'$$;
      CREATE FUNCTION knowledge_tin_membership_key(text) RETURNS bigint LANGUAGE sql IMMUTABLE AS $$SELECT hashtextextended('embedding_keyword_tin:' || $1, 0)$$;
      CREATE FUNCTION knowledge_tin_stream(vector tsvector) RETURNS text LANGUAGE sql IMMUTABLE AS $$
        SELECT coalesce(string_agg(entry.lexeme, ' ' ORDER BY position), '')
        FROM unnest(vector) AS entry(lexeme, positions, weights), unnest(entry.positions) AS position
      $$;
      CREATE FUNCTION tin_fixture_match(text, text) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true';
      CREATE OPERATOR ==> (LEFTARG = text, RIGHTARG = text, FUNCTION = tin_fixture_match);`)
    )
  }
}, 60_000)

afterAll(async () => {
  if (createdTinShims) {
    await db.execute(
      sql.raw(`DROP OPERATOR IF EXISTS ==> (text, text);
      DROP FUNCTION IF EXISTS tin_fixture_match(text, text);
      DROP FUNCTION IF EXISTS knowledge_tin_base_token(text);
      DROP FUNCTION IF EXISTS knowledge_tin_membership_key(text);
      DROP FUNCTION IF EXISTS knowledge_tin_stream(tsvector);
      DROP SCHEMA IF EXISTS tin CASCADE;`)
    )
  }
  await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
  await db.delete(credentialGroup).where(eq(credentialGroup.id, groupId))
  await db.delete(organization).where(eq(organization.id, ids.organizationId))
  await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  await projector?.end()
  forgetProjectionFilled()
})

/**
 * Every test starts from one converged chunk readable by Alice and Bob: whatever the last test
 * left is removed, the chunk is written again, and the projector converges it. It is written
 * deferred, so the projector writes all three projections: this database has no Tin extension,
 * so no synchronous trigger would write the Tin row.
 */
beforeEach(async () => {
  await db.delete(embedding).where(eq(embedding.documentId, documentId))
  await db
    .update(document)
    .set({ acl: aclOf('alice', 'bob'), connectorId })
    .where(eq(document.id, documentId))
  await write('async', (tx) => tx.insert(embedding).values(chunkRow(chunkId, 0)))
  await project()
  forgetProjectionFilled()
})

describe.each(['sync', 'async'] as const)('a %s writer', (mode) => {
  it('revokes a grant before the projector runs, on both rankings', async () => {
    await write(mode, (tx) =>
      tx
        .update(document)
        .set({ acl: aclOf('bob') })
        .where(eq(document.id, documentId))
    )
    expect(await markOf()).toMatchObject({ content: false })
    if (mode === 'async') {
      /** The rows still name Alice: only the mark keeps her out. */
      expect((await rowAcl(embeddingSearch))?.acl).toEqual(aclOf('alice', 'bob'))
      expect((await rowAcl(embeddingKeywordTin))?.acl).toEqual(aclOf('alice', 'bob'))
    }
    expect(await admitted()).toEqual({ vector: [], keyword: [] })
    expect(await vectorIds()).toEqual([])
    expect(await keywordIds()).toEqual([])

    await project()
    expect(await markOf()).toBeUndefined()
    expect((await rowAcl(embeddingSearch))?.acl).toEqual(aclOf('bob'))
    expect((await rowAcl(embeddingKeywordTin))?.acl).toEqual(aclOf('bob'))
    expect(await admitted()).toEqual({ vector: [], keyword: [] })
  })

  it('serves a new grant before the projector runs, on both rankings', async () => {
    await db
      .update(document)
      .set({ acl: aclOf('bob') })
      .where(eq(document.id, documentId))
    await project()
    expect(await vectorIds()).toEqual([])

    await write(mode, (tx) =>
      tx
        .update(document)
        .set({ acl: aclOf('alice', 'bob') })
        .where(eq(document.id, documentId))
    )
    if (mode === 'async') expect((await rowAcl(embeddingSearch))?.acl).toEqual(aclOf('bob'))
    expect(await admitted()).toEqual({ vector: [chunkId], keyword: [chunkId] })
    expect(await vectorIds()).toEqual([chunkId])
    expect(await keywordIds()).toEqual([chunkId])
  })

  it('decides a document that moved to a source outside the plan on the document', async () => {
    await write(mode, (tx) =>
      tx.update(document).set({ connectorId: otherConnectorId }).where(eq(document.id, documentId))
    )
    if (mode === 'async') expect((await rowAcl(embeddingSearch))?.connectorId).toBe(connectorId)
    expect(await admitted()).toEqual({ vector: [], keyword: [] })
    expect(await vectorIds()).toEqual([])
    expect(await keywordIds()).toEqual([])
    await project()
    expect((await rowAcl(embeddingSearch))?.connectorId).toBe(otherConnectorId)
  })

  it('hides a disabled chunk at once', async () => {
    await write(mode, (tx) =>
      tx.update(embedding).set({ enabled: false }).where(eq(embedding.id, chunkId))
    )
    expect(await markOf()).toMatchObject({ content: mode === 'async' })
    expect(await vectorIds()).toEqual([])
    expect(await keywordIds()).toEqual([])
    await project()
    expect((await rowAcl(embeddingSearch))?.enabled).toBe(false)
  })

  it('removes a deleted chunk from every projection in the deleting statement', async () => {
    await write(mode, (tx) => tx.delete(embedding).where(eq(embedding.id, chunkId)))
    expect(await rowAcl(embeddingSearch)).toBeUndefined()
    expect(await rowAcl(embeddingKeywordTin)).toBeUndefined()
    expect(await vectorIds()).toEqual([])
  })

  it('makes a new chunk searchable, at once or once the projector runs', async () => {
    const added = generateId()
    await write(mode, (tx) => tx.insert(embedding).values(chunkRow(added, 1)))
    expect(await markOf()).toMatchObject({ content: mode === 'async' })
    const expected = [chunkId, added].sort()
    if (mode === 'sync') {
      expect(await vectorIds()).toEqual(expected)
    } else {
      expect(await rowAcl(embeddingSearch, added)).toBeUndefined()
      expect(await vectorIds()).toEqual([chunkId])
    }
    await project()
    expect(await markOf()).toBeUndefined()
    expect(await vectorIds()).toEqual(expected)
    /** A synchronous writer's Tin row is its trigger's, which only a database with Tin has. */
    if (mode === 'async') expect(await keywordIds()).toEqual(expected)
  })
})

describe('the projector', () => {
  it('keeps a mark that a write bumped during its pass, and settles it on the next', async () => {
    await db
      .update(document)
      .set({ acl: aclOf('bob') })
      .where(eq(document.id, documentId))
    const before = await markOf()
    let bumped = false
    await project({
      onPage: async () => {
        if (bumped) return
        bumped = true
        await db
          .update(document)
          .set({ acl: aclOf('alice') })
          .where(eq(document.id, documentId))
      },
    })
    expect(bumped).toBe(true)
    const after = await markOf()
    expect(after?.generation).toBe((before?.generation ?? 0) + 1)
    await project()
    expect(await markOf()).toBeUndefined()
    expect((await rowAcl(embeddingSearch))?.acl).toEqual(aclOf('alice'))
  })

  it('keeps the mark when a synchronous ACL change commits under a page that then writes stale values', async () => {
    /** A pending revocation of Bob: the rows still name both until a pass. */
    await write('async', (tx) =>
      tx
        .update(document)
        .set({ acl: aclOf('alice') })
        .where(eq(document.id, documentId))
    )
    const before = await markOf()
    const [{ pid }] = await projector<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
    /**
     * A synchronous writer revokes Alice too and holds its transaction open: its fan-out has
     * locked the projection rows and its mark bump is not yet visible.
     */
    const writer = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => undefined })
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let locked: () => void = () => {}
    const fannedOut = new Promise<void>((resolve) => {
      locked = resolve
    })
    try {
      const writing = writer.begin(async (tx) => {
        await tx`UPDATE document SET acl = ${aclOf('bob')} WHERE id = ${documentId}`
        locked()
        await held
      })
      await fannedOut
      /**
       * The pass reads the committed document, Alice alone, and its page blocks on the rows the
       * writer holds. Once the writer commits, the page rewrites those rows from what it read.
       */
      const pass = project()
      await vi.waitFor(async () => {
        const [activity] = await db.execute<{ waiting: boolean }>(
          sql`SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = ${pid}`
        )
        expect(activity?.waiting).toBe(true)
      })
      release()
      await writing
      await pass
    } finally {
      release()
      await writer.end()
    }
    /** The page wrote the value it read over the writer's newer one. */
    expect((await rowAcl(embeddingSearch))?.acl).toEqual(aclOf('alice'))
    /** The writer's bump is what the pass could not settle over: the rows stay decided on the document. */
    expect((await markOf())?.generation).toBe((before?.generation ?? 0) + 1)
    expect(await admitted()).toEqual({ vector: [], keyword: [] })
    expect(await vectorIds()).toEqual([])
    await project()
    expect(await markOf()).toBeUndefined()
    expect((await rowAcl(embeddingSearch))?.acl).toEqual(aclOf('bob'))
    expect((await rowAcl(embeddingKeywordTin))?.acl).toEqual(aclOf('bob'))
    expect(await admitted()).toEqual({ vector: [], keyword: [] })
  })

  it('passes over a document deleted while it is being projected', async () => {
    const doomed = generateId()
    await db.insert(document).values({
      id: doomed,
      connectorId,
      knowledgeBaseId: ids.knowledgeBaseId,
      externalId: 'doomed-file',
      filename: 'doomed.md',
      fileUrl: 'https://fixture.test/doomed',
      fileSize: 12,
      mimeType: 'text/plain',
      processingStatus: 'completed',
      acl: aclOf('alice'),
    })
    await write('async', (tx) =>
      tx.insert(embedding).values(
        Array.from({ length: 3 }, (_, index) => ({
          ...chunkRow(generateId(), index),
          documentId: doomed,
        }))
      )
    )
    await expect(
      project({
        pageSize: 1,
        onPage: async (page) => {
          if (page.documentId === doomed) await db.delete(document).where(eq(document.id, doomed))
        },
      })
    ).resolves.toMatchObject({ remaining: false })
    const [left] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(embeddingSearch)
      .where(eq(embeddingSearch.documentId, doomed))
    expect(left?.count).toBe(0)
    expect(
      await db
        .select()
        .from(knowledgeProjectionDirty)
        .where(eq(knowledgeProjectionDirty.documentId, doomed))
    ).toEqual([])
  })

  it("rewrites a connector ACL page's projection rows in the page's own statement", async () => {
    await leaseTransaction(connectorId)((tx) =>
      tx
        .update(document)
        .set({ acl: aclOf('bob') })
        .where(eq(document.id, documentId))
    )
    expect(await markOf()).toMatchObject({ content: false })
    expect((await rowAcl(embeddingSearch))?.acl).toEqual(aclOf('bob'))
    expect(await admitted()).toEqual({ vector: [], keyword: [] })
    await project()
    expect(await markOf()).toBeUndefined()
  })

  it('splits the marks between passes that start together', async () => {
    const documents = await Promise.all(
      Array.from({ length: 6 }, async (_, index) => {
        const id = generateId()
        await db.insert(document).values({
          id,
          connectorId,
          knowledgeBaseId: ids.knowledgeBaseId,
          externalId: `split-${index}`,
          filename: `split-${index}.md`,
          fileUrl: `https://fixture.test/split-${index}`,
          fileSize: 12,
          mimeType: 'text/plain',
          processingStatus: 'completed',
          acl: aclOf('alice'),
        })
        return id
      })
    )
    await write('async', (tx) =>
      tx
        .insert(embedding)
        .values(
          documents.map((id, index) => ({ ...chunkRow(generateId(), index), documentId: id }))
        )
    )
    const second = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => undefined })
    try {
      /** Each page lingers, so neither pass can finish the batch before the other starts. */
      const lingering = { onPage: () => sleep(25), searchIndexes: true }
      const passes = await Promise.all([
        project(lingering),
        runKnowledgeProjection(second, lingering),
      ])
      expect(passes.every((pass) => pass.settled > 0)).toBe(true)
      expect(passes[0].settled + passes[1].settled).toBe(documents.length)
    } finally {
      await second.end()
    }
    expect(
      await db
        .select()
        .from(knowledgeProjectionDirty)
        .where(inArray(knowledgeProjectionDirty.documentId, documents))
    ).toEqual([])
    await db.delete(document).where(inArray(document.id, documents))
  })

  it('writes in pages bounded by chunk rows', async () => {
    await write('async', (tx) =>
      tx
        .insert(embedding)
        .values(Array.from({ length: 4 }, (_, index) => chunkRow(generateId(), index + 1)))
    )
    const pages: Array<{ projection: KnowledgeProjection; written: number }> = []
    await project({ pageSize: 2, onPage: (page) => void pages.push(page) })
    const vectorPages = pages.filter((page) => page.projection === 'embedding_search')
    expect(vectorPages.map((page) => page.written)).toEqual([1, 2, 1])
    expect(pages.every((page) => page.written <= 2)).toBe(true)
    expect(await markOf()).toBeUndefined()
  })

  it.each(['sync', 'async'] as const)(
    'writes %s projection rows from a chunk commit only when the writer did not defer them',
    async (mode) => {
      /**
       * The projector's single connection makes the write, so its own statistics can be flushed
       * and read back without waiting on the collector's interval.
       */
      const inserted = async () => {
        await projector`SELECT pg_stat_force_next_flush()`
        await projector`SELECT pg_stat_clear_snapshot()`
        const [row] = await projector<Array<{ inserted: string }>>`
          SELECT n_tup_ins AS inserted FROM pg_stat_user_tables WHERE relname = 'embedding_search'`
        return Number(row?.inserted ?? 0)
      }
      const chunks = Array.from({ length: 50 }, (_, index) => chunkRow(generateId(), index + 1))
      const before = await inserted()
      await projector.begin(async (tx) => {
        if (mode === 'async') await tx`SELECT set_config('sim.projection_mode', 'async', true)`
        for (const chunk of chunks) {
          await tx`INSERT INTO embedding (id, document_id, knowledge_base_id, chunk_index, chunk_hash,
              content, content_length, token_count, start_offset, end_offset, embedding_model, embedding)
            VALUES (${chunk.id}, ${documentId}, ${ids.knowledgeBaseId}, ${chunk.chunkIndex},
              ${chunk.chunkHash}, ${chunk.content}, 14, 2, 0, 14, ${chunk.embeddingModel},
              ${JSON.stringify(vector)}::vector)`
        }
      })
      expect((await inserted()) - before).toBe(mode === 'async' ? 0 : chunks.length)
      expect(await markOf()).toMatchObject({ content: mode === 'async' })
    }
  )

  it('owes a pass for content and, while indexed search is on, search-index marks, asking only for content behind an undrained release', async () => {
    const workspaceBaseId = generateId()
    const [workspaceDocument, contentDocument] = [generateId(), generateId()]
    await db.insert(knowledgeBase).values({
      id: workspaceBaseId,
      userId: ids.aliceId,
      workspaceId: ids.workspaceId,
      name: 'Workspace work fixture',
      chunkingConfig: { maxSize: 1024, minSize: 1, overlap: 20 },
    })
    /** Thrown to roll the transaction back, so the marks of other suites are never touched for good. */
    const rollback = new Error('rollback')
    try {
      await db.insert(document).values(
        [workspaceDocument, contentDocument].map((id, index) => ({
          id,
          knowledgeBaseId: workspaceBaseId,
          filename: `work-${index}.md`,
          fileUrl: `https://fixture.test/work-${index}`,
          fileSize: 12,
          mimeType: 'text/plain',
          processingStatus: 'completed' as const,
        }))
      )
      const answers: Record<string, { drained: boolean; undrained: boolean; dormant: boolean }> = {}
      const indexed = { searchIndexes: true }
      const answer = async (tx: postgres.TransactionSql, label: string) => {
        answers[label] = {
          drained: await hasKnowledgeProjectionWork(tx, { drained: true }, indexed),
          undrained: await hasKnowledgeProjectionWork(tx, { drained: false }, indexed),
          dormant: await hasKnowledgeProjectionWork(
            tx,
            { drained: true },
            { searchIndexes: false }
          ),
        }
      }
      await projector
        .begin(async (tx) => {
          await tx`DELETE FROM knowledge_projection_dirty`
          await tx`SELECT mark_knowledge_projection(ARRAY[${workspaceDocument}]::text[], false)`
          await answer(tx, 'workspace')
          await tx`SELECT mark_knowledge_projection(ARRAY[${documentId}]::text[], false)`
          await answer(tx, 'search index')
          await tx`SELECT mark_knowledge_projection(ARRAY[${contentDocument}]::text[], true)`
          await answer(tx, 'content')
          throw rollback
        })
        .catch((error) => {
          if (error !== rollback) throw error
        })
      expect(answers).toEqual({
        workspace: { drained: false, undrained: false, dormant: false },
        'search index': { drained: true, undrained: false, dormant: false },
        content: { drained: true, undrained: true, dormant: true },
      })
    } finally {
      await db.delete(knowledgeBase).where(eq(knowledgeBase.id, workspaceBaseId))
    }
  })

  it('releases marks with nothing to project, keeping search-index marks for a pass only while indexed search is on', async () => {
    const workspaceBaseId = generateId()
    const [synced, deferred, held] = [generateId(), generateId(), generateId()]
    await db.insert(knowledgeBase).values({
      id: workspaceBaseId,
      userId: ids.aliceId,
      workspaceId: ids.workspaceId,
      name: 'Workspace fixture',
      chunkingConfig: { maxSize: 1024, minSize: 1, overlap: 20 },
    })
    try {
      await db.insert(document).values(
        [synced, deferred, held].map((id, index) => ({
          id,
          knowledgeBaseId: workspaceBaseId,
          filename: `workspace-${index}.md`,
          fileUrl: `https://fixture.test/workspace-${index}`,
          fileSize: 12,
          mimeType: 'text/plain',
          processingStatus: 'completed' as const,
        }))
      )
      const workspaceChunk = (id: string, documentId: string) => ({
        ...chunkRow(id, 0),
        documentId,
        knowledgeBaseId: workspaceBaseId,
      })
      const deferredChunk = generateId()
      await write('sync', (tx) =>
        tx
          .insert(embedding)
          .values([workspaceChunk(generateId(), synced), workspaceChunk(generateId(), held)])
      )
      await write('async', (tx) =>
        tx.insert(embedding).values(workspaceChunk(deferredChunk, deferred))
      )
      /** A search-index mark with nothing but a source and ACL change is still a pass's. */
      await db
        .update(document)
        .set({ acl: aclOf('bob') })
        .where(eq(document.id, documentId))
      const marked = async () =>
        (
          await db
            .select({ documentId: knowledgeProjectionDirty.documentId })
            .from(knowledgeProjectionDirty)
            .where(
              inArray(knowledgeProjectionDirty.documentId, [synced, deferred, held, documentId])
            )
        )
          .map((row) => row.documentId)
          .sort()

      /** A writer re-marking `held` holds its mark until it commits; the release passes it over. */
      const writer = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => undefined })
      let release: () => void = () => {}
      const holding = new Promise<void>((resolve) => {
        release = resolve
      })
      let locked: () => void = () => {}
      const marking = new Promise<void>((resolve) => {
        locked = resolve
      })
      try {
        const writing = writer.begin(async (tx) => {
          await tx`SELECT mark_knowledge_projection(ARRAY[${held}]::text[], false)`
          locked()
          await holding
        })
        await marking
        expect(
          (await releaseSettledMarks(projector, Number.POSITIVE_INFINITY, { searchIndexes: true }))
            .released
        ).toBeGreaterThanOrEqual(1)
        expect(await marked()).toEqual([deferred, held, documentId].sort())
        release()
        await writing
      } finally {
        release()
        await writer.end()
      }
      expect(
        (await releaseSettledMarks(projector, Number.POSITIVE_INFINITY, { searchIndexes: true }))
          .released
      ).toBeGreaterThanOrEqual(1)
      expect(await marked()).toEqual([deferred, documentId].sort())

      /** The deferred chunk has no row until a pass writes it, and the pass settles both marks. */
      const deferredRow = async () =>
        db
          .select({ id: embeddingSearch.id })
          .from(embeddingSearch)
          .where(eq(embeddingSearch.id, deferredChunk))
      expect(await deferredRow()).toEqual([])
      await project()
      expect(await deferredRow()).toEqual([{ id: deferredChunk }])
      expect(await marked()).toEqual([])
      expect((await rowAcl(embeddingSearch))?.acl).toEqual(aclOf('bob'))

      /** While indexed search is dormant, nothing reads a search-index mark, so it is released too. */
      await db
        .update(document)
        .set({ acl: aclOf('alice') })
        .where(eq(document.id, documentId))
      expect(await marked()).toEqual([documentId])
      await releaseSettledMarks(projector, Number.POSITIVE_INFINITY, { searchIndexes: false })
      expect(await marked()).toEqual([])
    } finally {
      await db.delete(knowledgeBase).where(eq(knowledgeBase.id, workspaceBaseId))
    }
  })
})
