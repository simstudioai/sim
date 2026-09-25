/**
 * The knowledge projector and the readers that must stay correct while it lags. A GitHub member
 * source's document is changed by a writer in either projection mode — synchronous, as every
 * writer before the projector, or asynchronous, where the writer only marks the document — and
 * search is checked before the projector runs: a revoked member is refused and a granted one is
 * served, on the vector and keyword legs and under the source filter, and a disabled or deleted
 * chunk is gone at once. The projector's own contract follows: it converges the rows and removes
 * the mark, keeps a mark that a write bumped during its pass, survives a document deleted under
 * it, writes in pages bounded by chunk rows, fills rows written before they carried a source and
 * ACL, and an asynchronous commit writes no projection row at all.
 */
import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import {
  DEFER_KNOWLEDGE_PROJECTION,
  FILL_MARK_CEILING,
  type KnowledgeProjection,
  markUnfilledProjectionDocuments,
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
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/** The TINQL `resolveTinKeywordQuery` renders for `fixture`: its `english` stem, quoted. */
vi.mock('@/lib/knowledge/search/tin-keyword', () => ({
  resolveTinKeywordQuery: async () => '"fixtur"',
}))

/** The flags a test turns on; connector writers read `knowledge-async-projection` from here. */
const { enabledFlags, requestKnowledgeProjection } = vi.hoisted(() => ({
  enabledFlags: new Set<string>(),
  requestKnowledgeProjection: vi.fn(async () => {}),
}))
vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: async (flag: string) => enabledFlags.has(flag),
}))
/**
 * Writers ask for a pass once they commit; here that request is only recorded, so the passes each
 * test runs are the only ones and a background pass cannot converge rows a test is inspecting.
 */
vi.mock('@/lib/knowledge/projection/enqueue', () => ({ requestKnowledgeProjection }))

import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import {
  projectionCandidateAccessCondition,
  type SearchAccessPlan,
} from '@/lib/knowledge/access/predicate'
import type {
  GitHubInstallationReadGrant,
  KnowledgeAccessProvider,
  UserAccessScope,
} from '@/lib/knowledge/access/types'
import { leaseTransaction } from '@/lib/knowledge/connectors/sync-lock'
import {
  executeKeywordSearch,
  forgetProjectionFilled,
  handleVectorOnlySearch,
  liveSourceAccessFor,
} from '@/lib/knowledge/search/queries'
import { GITHUB_INSTALLATION_PROVIDER_ID } from '@/lib/oauth/github-installation-types'

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
 * A direction no other integration file writes. The vector legs here walk the approximate index,
 * which the files sharing this database crowd with `[1, 0, …]` rows; tied at distance zero with
 * this file's chunks, those can exhaust the walk's tuple cap before it reaches them. Inside the
 * first 512 dimensions, the only ones the candidate projection keeps.
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

function searchInputs() {
  const granted = { ...scope, githubInstallationGrants: [grant] }
  const accessProvider: KnowledgeAccessProvider = {
    get: async () => scope,
    getForConnectors: async () => granted,
    getForDocuments: async () => granted,
    liveSourceConnectorCondition: async () => null,
  }
  return {
    knowledgeBaseIds: [ids.knowledgeBaseId],
    topK: 20,
    access: scope,
    accessProvider,
    accessPlan: plan,
    liveSourceAccess: liveSourceAccessFor(scope, plan, accessProvider),
    queryVector,
  }
}

const keywordIds = async () =>
  (
    await executeKeywordSearch({
      ...searchInputs(),
      query: 'fixture',
      permitted: { kind: 'unbounded', broad: false },
      searchIndexOnly: true,
    })
  )
    .map((row) => row.id)
    .sort()

const vectorIds = async () =>
  (
    await handleVectorOnlySearch({
      ...searchInputs(),
      distanceThreshold: 2,
      permitted: { kind: 'unbounded', broad: true },
    })
  )
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

/** Runs a write in a transaction of the given projection mode, as a knowledge writer would. */
function write(
  mode: Mode,
  work: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<unknown>
) {
  return db.transaction(async (tx) => {
    if (mode === 'async') await tx.execute(sql.raw(`SELECT ${DEFER_KNOWLEDGE_PROJECTION}`))
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
const project = (options: Parameters<typeof runKnowledgeProjection>[1] = {}) =>
  runKnowledgeProjection(projector, options)

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
  requestKnowledgeProjection.mockClear()
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

  it.each([false, true])(
    "leaves a connector ACL page's projection rows to the projector only while the flag is on (%s)",
    async (flagOn) => {
      if (flagOn) enabledFlags.add('knowledge-async-projection')
      try {
        await leaseTransaction(connectorId)((tx) =>
          tx
            .update(document)
            .set({ acl: aclOf('bob') })
            .where(eq(document.id, documentId))
        )
      } finally {
        enabledFlags.delete('knowledge-async-projection')
      }
      expect(requestKnowledgeProjection).toHaveBeenCalledOnce()
      expect(await markOf()).toMatchObject({ content: false })
      expect((await rowAcl(embeddingSearch))?.acl).toEqual(
        flagOn ? aclOf('alice', 'bob') : aclOf('bob')
      )
      expect(await admitted()).toEqual({ vector: [], keyword: [] })
      await project()
      expect((await rowAcl(embeddingSearch))?.acl).toEqual(aclOf('bob'))
    }
  )

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
      const lingering = { onPage: () => sleep(25) }
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

  it('fills rows written before they carried a source and ACL, and converges them', async () => {
    for (const table of [embeddingSearch, embeddingKeywordTin]) {
      await db
        .update(table)
        .set({ connectorId: null, acl: null })
        .where(eq(table.documentId, documentId))
    }
    expect(await markOf()).toBeUndefined()
    let cursor: Parameters<typeof markUnfilledProjectionDocuments>[1] | null
    let marked = 0
    while (cursor !== null) {
      const fill = await markUnfilledProjectionDocuments(projector, cursor)
      marked += fill.marked
      cursor = fill.cursor
      await project()
    }
    expect(marked).toBeGreaterThanOrEqual(1)
    expect(await rowAcl(embeddingSearch)).toMatchObject({ acl: aclOf('alice', 'bob'), connectorId })
    expect(await rowAcl(embeddingKeywordTin)).toMatchObject({
      acl: aclOf('alice', 'bob'),
      connectorId,
    })
    expect(await markOf()).toBeUndefined()
  })

  it('fills every document when more are unfilled than the fill may mark at once', async () => {
    const documents = Array.from({ length: FILL_MARK_CEILING + 20 }, () => generateId())
    await db.insert(document).values(
      documents.map((id, index) => ({
        id,
        connectorId,
        knowledgeBaseId: ids.knowledgeBaseId,
        externalId: `fill-${index}`,
        filename: `fill-${index}.md`,
        fileUrl: `https://fixture.test/fill-${index}`,
        fileSize: 12,
        mimeType: 'text/plain',
        processingStatus: 'completed' as const,
        acl: aclOf('alice', 'bob'),
      }))
    )
    /** Two chunks each, whose random ids interleave the documents' rows in the unfilled index. */
    await write('async', (tx) =>
      tx
        .insert(embedding)
        .values(
          documents.flatMap((id) =>
            [0, 1].map((chunkIndex) => ({ ...chunkRow(generateId(), chunkIndex), documentId: id }))
          )
        )
    )
    await project()
    /** Only the vector rows, so no other projection's unfilled rows lead the fill back to them. */
    await db
      .update(embeddingSearch)
      .set({ connectorId: null, acl: null })
      .where(inArray(embeddingSearch.documentId, documents))
    let cursor: Parameters<typeof markUnfilledProjectionDocuments>[1] | null
    let marked = 0
    while (cursor !== null) {
      const fill = await markUnfilledProjectionDocuments(projector, cursor)
      marked += fill.marked
      cursor = fill.cursor
      await project()
    }
    expect(marked).toBeGreaterThanOrEqual(documents.length)
    expect(
      await db
        .select({ id: embeddingSearch.id })
        .from(embeddingSearch)
        .where(and(inArray(embeddingSearch.documentId, documents), isNull(embeddingSearch.acl)))
    ).toEqual([])
    await db.delete(document).where(inArray(document.id, documents))
  })

  it('marks what it can while a document it chose is deleted under it', async () => {
    const [deleted, kept] = [generateId(), generateId()]
    await db.insert(document).values(
      [deleted, kept].map((id, index) => ({
        id,
        connectorId,
        knowledgeBaseId: ids.knowledgeBaseId,
        externalId: `fill-race-${index}`,
        filename: `fill-race-${index}.md`,
        fileUrl: `https://fixture.test/fill-race-${index}`,
        fileSize: 12,
        mimeType: 'text/plain',
        processingStatus: 'completed' as const,
        acl: aclOf('alice', 'bob'),
      }))
    )
    await write('async', (tx) =>
      tx
        .insert(embedding)
        .values([deleted, kept].map((id) => ({ ...chunkRow(generateId(), 0), documentId: id })))
    )
    await project()
    for (const table of [embeddingSearch, embeddingKeywordTin]) {
      await db
        .update(table)
        .set({ connectorId: null, acl: null })
        .where(inArray(table.documentId, [deleted, kept]))
    }
    const deleter = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => undefined })
    try {
      /** The deletion is under way when the fill reads, and commits while the fill still runs. */
      let fill: ReturnType<typeof markUnfilledProjectionDocuments> | undefined
      let settled = false
      await deleter.begin(async (tx) => {
        await tx`DELETE FROM document WHERE id = ${deleted}`
        fill = markUnfilledProjectionDocuments(projector)
        void fill.then(
          () => {
            settled = true
          },
          () => {
            settled = true
          }
        )
        await vi.waitFor(
          async () => {
            const [row] = await db.execute<{ waiting: boolean }>(
              sql`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE NOT granted) AS waiting`
            )
            expect(settled || Boolean(row?.waiting)).toBe(true)
          },
          { timeout: 5_000, interval: 10 }
        )
      })
      await expect(fill).resolves.toMatchObject({ marked: expect.any(Number) })
      const marks = await db
        .select({ documentId: knowledgeProjectionDirty.documentId })
        .from(knowledgeProjectionDirty)
        .where(inArray(knowledgeProjectionDirty.documentId, [deleted, kept]))
      expect(marks.map((mark) => mark.documentId)).toEqual([kept])
    } finally {
      await deleter.end()
      await project()
      await db.delete(document).where(inArray(document.id, [deleted, kept]))
    }
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
})
