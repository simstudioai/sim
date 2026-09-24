/**
 * A search candidate's source decides whether the caller's live source proof is resolved before
 * its content is read. These fixtures put a GitHub installation source's chunks on projection rows
 * the source and ACL fill has not reached (`acl` and `connector_id` NULL), and check that such a
 * chunk still reaches a member who holds the installation grant, stays hidden from one who does
 * not, and is left out of a page once its source is known to be denied.
 */
import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  document,
  embedding,
  embeddingKeywordTin,
  embeddingSearch,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeDocumentObservation,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/** This suite covers indexed organization search, which is dormant unless Live Search is off. */
vi.mock('@/lib/core/config/env-flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/config/env-flags')>()),
  isLiveEnterpriseSearchEnabled: false,
}))
/** The TINQL `resolveTinKeywordQuery` renders for `fixture`: its `english` stem, quoted. */
vi.mock('@/lib/sim-search/indexed/retrieval/tin-keyword', () => ({
  resolveTinKeywordQuery: async () => '"fixtur"',
}))

import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import type { SearchAccessPlan } from '@/lib/knowledge/access/predicate'
import type {
  GitHubInstallationReadGrant,
  KnowledgeAccessProvider,
  UserAccessScope,
} from '@/lib/knowledge/access/types'
import {
  executeKeywordSearch,
  handleVectorOnlySearch,
  liveSourceAccessFor,
} from '@/lib/knowledge/search/queries'
import { GITHUB_INSTALLATION_PROVIDER_ID } from '@/lib/oauth/github-installation-types'
import { forgetProjectionFilled } from '@/lib/sim-search/indexed/retrieval'

const ids = createKnowledgeAclFixtureIds()
const connectorId = generateId()
const contentCredentialId = generateId()
const groupId = generateId()
const optionId = generateId()
const documentId = generateId()
const embeddingId = generateId()
const repositoryId = '4242'
const members = {
  alice: { id: generateId(), subject: 'alice-gh', credentialId: generateId() },
  bob: { id: generateId(), subject: 'bob-gh', credentialId: generateId() },
}
const userIdOf = (who: 'alice' | 'bob') => (who === 'alice' ? ids.aliceId : ids.bobId)
const subjectToken = (subject: string) => `s:github-repositories:-:${subject}`
const queryVector = {
  vector: JSON.stringify([1, ...Array<number>(1535).fill(0)]),
  dimensions: 1536 as const,
  model: 'text-embedding-3-small',
}

/** The shims stand in for the Tin extension, which the test database does not carry. */
let createdTinShims = false

const scopeFor = (who: 'alice' | 'bob'): UserAccessScope => ({
  kind: 'user',
  userId: userIdOf(who),
  tokens: [
    'pub',
    subjectToken(members[who].subject),
    `u:${userIdOf(who)}@fixture.test`,
    'ws',
  ].sort(),
})

const planFor = (who: 'alice' | 'bob'): SearchAccessPlan => ({
  connectors: {
    workspace: [],
    admin: [],
    members: [connectorId],
    liveProofRequired: [connectorId],
  },
  observers: { confirmed: [{ id: members[who].id, connectorId }], observed: [] },
  memberSources: [connectorId],
  connectorTypes: new Map([[connectorId, 'github']]),
  uploads: false,
})

/** Alice's reader credential backs a real installation grant; Bob holds none. */
const aliceGrant: GitHubInstallationReadGrant = {
  connectorId,
  contentCredentialId,
  readerCredentialId: members.alice.credentialId,
  readerSubjectToken: subjectToken(members.alice.subject),
  repositoryId,
}

function searchInputs(who: 'alice' | 'bob') {
  const access = scopeFor(who)
  const accessPlan = planFor(who)
  const granted = who === 'alice' ? { ...access, githubInstallationGrants: [aliceGrant] } : access
  const accessProvider: KnowledgeAccessProvider = {
    get: async () => access,
    getForConnectors: async () => granted,
    getForDocuments: async () => granted,
    liveSourceConnectorCondition: async () => null,
  }
  return {
    knowledgeBaseIds: [ids.knowledgeBaseId],
    topK: 5,
    access,
    accessProvider,
    accessPlan,
    liveSourceAccess: liveSourceAccessFor(access, accessPlan, accessProvider),
    queryVector,
  }
}

const keywordIds = async (who: 'alice' | 'bob') =>
  (
    await executeKeywordSearch({
      ...searchInputs(who),
      query: 'fixture',
      permitted: { kind: 'unbounded', broad: false },
      searchIndexOnly: true,
    })
  ).map((row) => row.id)

const vectorIds = async (who: 'alice' | 'bob') =>
  (
    await handleVectorOnlySearch({
      ...searchInputs(who),
      distanceThreshold: 2,
      permitted: { kind: 'unbounded', broad: true },
    })
  ).map((row) => row.id)

async function setProjection(state: 'filled' | 'unfilled') {
  for (const table of [embeddingSearch, embeddingKeywordTin]) {
    await db
      .update(table)
      .set(
        state === 'filled'
          ? {
              connectorId,
              acl: [subjectToken(members.alice.subject), subjectToken(members.bob.subject)].sort(),
            }
          : { connectorId: null, acl: null }
      )
      .where(eq(table.id, embeddingId))
  }
  forgetProjectionFilled()
}

beforeAll(async () => {
  await seedKnowledgeAclFixture(ids)
  const now = new Date()
  await db
    .update(user)
    .set({ emailVerified: true })
    .where(inArray(user.id, [ids.aliceId, ids.bobId]))
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
    const [enrollment] = await db
      .insert(credentialGroupEnrollment)
      .values({
        id: generateId(),
        credentialGroupId: groupId,
        userId: userIdOf(who),
        email: `${userIdOf(who)}@fixture.test`,
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
      createdBy: userIdOf(who),
    })
  }
  await db.insert(knowledgeConnector).values({
    id: connectorId,
    knowledgeBaseId: ids.knowledgeBaseId,
    connectorType: 'github',
    sourceConfig: { githubRepositoryId: repositoryId },
    accessMode: 'members',
    status: 'active',
    credentialId: contentCredentialId,
    credentialGroupId: groupId,
    credentialGroupOptionId: optionId,
  })
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
    acl: [subjectToken(members.alice.subject), subjectToken(members.bob.subject)].sort(),
  })
  await db.insert(knowledgeDocumentObservation).values(
    (['alice', 'bob'] as const).map((who) => ({
      documentId,
      memberId: members[who].id,
      lastSeenAt: now,
      runId: generateId(),
    }))
  )
  await db.insert(embedding).values({
    id: embeddingId,
    documentId,
    knowledgeBaseId: ids.knowledgeBaseId,
    chunkIndex: 0,
    chunkHash: 'fixture-hash',
    content: 'fixture readme',
    contentLength: 14,
    tokenCount: 2,
    startOffset: 0,
    endOffset: 14,
    embeddingModel: 'text-embedding-3-small',
    embedding: [1, ...Array<number>(1535).fill(0)],
  })
  const [tin] = await db.execute<{ present: boolean }>(
    sql`SELECT to_regnamespace('tin') IS NOT NULL AS present`
  )
  if (!tin?.present) {
    createdTinShims = true
    await db.execute(
      sql.raw(`CREATE SCHEMA tin;
      CREATE FUNCTION tin.full_score(tid) RETURNS double precision LANGUAGE sql IMMUTABLE AS 'SELECT 1.0::float8';
      CREATE FUNCTION knowledge_tin_base_token(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT 'kb'$$;
      CREATE FUNCTION knowledge_tin_stream(vector tsvector) RETURNS text LANGUAGE sql IMMUTABLE AS $$
        SELECT coalesce(string_agg(entry.lexeme, ' ' ORDER BY position), '')
        FROM unnest(vector) AS entry(lexeme, positions, weights), unnest(entry.positions) AS position
      $$;
      CREATE FUNCTION tin_fixture_match(text, text) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true';
      CREATE OPERATOR ==> (LEFTARG = text, RIGHTARG = text, FUNCTION = tin_fixture_match);`)
    )
  }
  /** Written as the projection trigger writes it, so real Tin scopes the row to its base. */
  await db.execute(sql`
    INSERT INTO ${embeddingKeywordTin} (id, knowledge_base_id, document_id, enabled, content)
    SELECT id, knowledge_base_id, document_id, enabled,
      knowledge_tin_base_token(knowledge_base_id) || ' ' || knowledge_tin_stream(content_tsv)
    FROM ${embedding} WHERE id = ${embeddingId}
    ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content`)
})

afterAll(async () => {
  if (createdTinShims) {
    await db.execute(
      sql.raw(`DROP OPERATOR IF EXISTS ==> (text, text);
      DROP FUNCTION IF EXISTS tin_fixture_match(text, text);
      DROP FUNCTION IF EXISTS knowledge_tin_base_token(text);
      DROP FUNCTION IF EXISTS knowledge_tin_stream(tsvector);
      DROP SCHEMA IF EXISTS tin CASCADE;`)
    )
  }
  await db.delete(embeddingKeywordTin).where(eq(embeddingKeywordTin.id, embeddingId))
  await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
  await db.delete(credentialGroup).where(eq(credentialGroup.id, groupId))
  await db.delete(organization).where(eq(organization.id, ids.organizationId))
  await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  forgetProjectionFilled()
})

describe('a chunk whose projection row the fill has not reached', () => {
  beforeEach(() => setProjection('unfilled'))

  it('reaches the member holding the installation grant through the keyword ranking', async () => {
    expect(await keywordIds('alice')).toEqual([embeddingId])
  })

  it('reaches the member holding the installation grant through the vector ranking', async () => {
    expect(await vectorIds('alice')).toEqual([embeddingId])
  })

  it('stays hidden from a member without the grant', async () => {
    expect(await keywordIds('bob')).toEqual([])
    expect(await vectorIds('bob')).toEqual([])
  })

  describe('once its source is known to be denied', () => {
    /** Each Tin ranking statement's page of candidates, in the order the search read them. */
    const pages: Array<{ candidates: unknown[] }> = []
    beforeEach(() => {
      pages.length = 0
      const execute = db.execute.bind(db)
      vi.spyOn(db, 'execute').mockImplementation((async (query: Parameters<typeof execute>[0]) => {
        const rows = await execute(query)
        const [row] = Array.from(rows)
        if (isRecordLike(row) && 'ranked' in row && Array.isArray(row.candidates))
          pages.push({ candidates: row.candidates })
        return rows
      }) as typeof db.execute)
    })
    afterEach(() => vi.restoreAllMocks())

    it('carries the source read from its document and is left out of the rebuilt keyword page', async () => {
      expect(await keywordIds('bob')).toEqual([])
      expect(pages.length).toBeGreaterThanOrEqual(2)
      expect(pages[0]!.candidates).toEqual([{ id: embeddingId, documentId, connectorId }])
      expect(pages.at(-1)!.candidates).toEqual([])
    })
  })
})

describe('a chunk whose projection row is filled', () => {
  beforeEach(() => setProjection('filled'))

  it('ranks on the row as before and is read only by the member holding the grant', async () => {
    const [{ unfilled }] = await db.execute<{ unfilled: boolean }>(
      sql`SELECT EXISTS (SELECT 1 FROM ${embeddingKeywordTin} WHERE ${embeddingKeywordTin.acl} IS NULL) AS unfilled`
    )
    expect(unfilled).toBe(false)
    expect(await keywordIds('alice')).toEqual([embeddingId])
    expect(await keywordIds('bob')).toEqual([])
    expect(await vectorIds('alice')).toEqual([embeddingId])
    expect(await vectorIds('bob')).toEqual([])
  })
})
