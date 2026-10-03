/**
 * Opt-in live Confluence verification. CONFLUENCE_LIVE_FIXTURE_FILE holds IDs,
 * never tokens: {workspaceId, domain, cloudId, spaceId, spaceKey,
 * adminCredentialId, memberCredentialIds}. Credentials must be saved through Sim
 * in the disposable ACL integration workspace. The first managed human has space
 * access; an optional second has site access but no access to this space.
 * CONFLUENCE_LIVE_OAUTH_FILE supplies the matching OAuth client JSON.
 *
 * Create an empty space named sim-search-e2e-* with key SIMSEARCHE2E* in the
 * browser. Its admin service-account token needs the connector's read scopes plus
 * write:page:confluence, delete:page:confluence, and write:confluence-content
 * for fixture pages, labels, and restrictions. Space grants are preconfigured:
 * v2 space creation is RBAC-only and v1 permission writes forbid app credentials.
 * All provider calls, credential resolution, engines, storage, and authorization
 * are real; only embeddings are substituted. Mutations target this run's pages.
 */
import { readFile } from 'node:fs/promises'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  credential,
  credentialGroupEnrollment,
  document,
  embedding,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('@/lib/embeddings', async () => ({
  ...(await import('@/lib/embeddings/client')),
  assertKnowledgeEmbeddingCapacity: async () => {},
  embedKnowledge: async (texts: string[]) => ({
    embeddings: texts.map(() => [1, ...Array<number>(1535).fill(0)]),
    totalTokens: texts.length,
    billableTokens: 0,
    isBYOK: true,
    modelName: 'text-embedding-3-small',
    pricingId: 'text-embedding-3-small',
  }),
}))

import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { requireCurrentHumanRole } from '@/lib/core/application/workspace-authorization'
import { env } from '@/lib/core/config/env'
import { loadManagedCredentialGroupBinding } from '@/lib/credential-groups/credentials'
import { confluenceSubjectToken } from '@/lib/knowledge/access/confluence-permissions'
import { subjectToken } from '@/lib/knowledge/access/tokens'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import { readKnowledgeDocument } from '@/lib/knowledge/application/documents'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import {
  grantKnowledgeConnectorCredentialAccess,
  mintKnowledgeConnectorMemberToken,
  revokeKnowledgeConnectorCredentialAccess,
} from '@/lib/knowledge/connectors/member-access'
import { executeMemberSync } from '@/lib/knowledge/connectors/member-sync-engine'
import { executeSync } from '@/lib/knowledge/connectors/sync-engine'
import {
  getAtlassianServiceAccountSecret,
  resolveCredentialTokenBundle,
} from '@/lib/oauth/credential-service'
import { ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'
import { confluenceConnector } from '@/connectors/confluence/confluence'
import { getReadRestriction } from '@/connectors/confluence/permissions'

const fixtureSchema = z.object({
  workspaceId: z.string().uuid(),
  domain: z.string().regex(/^[a-z0-9-]+\.atlassian\.net$/),
  cloudId: z.string().uuid(),
  spaceId: z.string().regex(/^\d+$/),
  spaceKey: z.string().regex(/^SIMSEARCHE2E[A-Z0-9]+$/),
  adminCredentialId: z.string().uuid(),
  memberCredentialIds: z.array(z.string().uuid()).min(1).max(2),
})
const pageSchema = z.object({
  id: z.string().regex(/^\d+$/),
  title: z.string(),
  spaceId: z.string(),
  version: z.object({ number: z.number().int().positive() }),
})
const fixtureFile = process.env.CONFLUENCE_LIVE_FIXTURE_FILE
const oauthFile = process.env.CONFLUENCE_LIVE_OAUTH_FILE

describe.skipIf(!fixtureFile)('live Confluence ingestion and permission parity', () => {
  const previousClient = { id: env.CONFLUENCE_CLIENT_ID, secret: env.CONFLUENCE_CLIENT_SECRET }
  let input: z.infer<typeof fixtureSchema>
  let ownerId: string
  let adminToken: string
  let adminSubject: string
  let groupId: string
  let optionId: string
  let parentId: string
  let childId: string
  let openId: string
  const kbId = generateId()
  const adminConnectorId = generateId()
  const memberConnectorId = generateId()
  const label = `sim-search-e2e-${generateId()}`
  const ownedPages = new Map<string, string>()
  const trashedPages = new Set<string>()
  const storedKeys = new Set<string>()
  const createdUsers: string[] = []
  const createdPermissions: string[] = []
  const members: Array<{
    credentialId: string
    userId: string
    subject: string
    token: string
  }> = []
  const sourceConfig = () => ({
    domain: input.domain,
    spaceKey: [input.spaceKey],
    contentType: 'page',
    labelFilter: label,
    maxPages: 0,
  })
  const actor = (userId: string): Principal => ({
    kind: 'session',
    userId,
    sessionId: 'confluence-live',
  })
  const scope = () => ({
    workspaceId: input.workspaceId,
    credentialGroupId: groupId,
    credentialGroupOptionId: optionId,
    connectorId: memberConnectorId,
  })

  async function response(path: string, token = adminToken, method = 'GET', body?: unknown) {
    return fetch(`https://api.atlassian.com/ex/confluence/${input.cloudId}/wiki${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    })
  }
  async function api(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const result = await response(path, adminToken, method, body)
    if (!result.ok)
      throw new Error(
        `Confluence fixture ${method} ${path}: HTTP ${result.status}. Check the selected site's fixture permissions and token scopes.`
      )
    return result.status === 204 ? undefined : result.json()
  }
  async function ownPage(id: string) {
    if (!ownedPages.has(id)) throw new Error('Refusing to mutate an unowned Confluence page')
    const page = pageSchema.parse(await api(`/api/v2/pages/${id}`))
    expect(page.spaceId).toBe(input.spaceId)
    expect(page.title).toBe(ownedPages.get(id))
    return page
  }
  async function createPage(name: string, parent?: string) {
    if (ownedPages.size >= 4) throw new Error('Confluence fixture page budget exceeded')
    if (parent) await ownPage(parent)
    const title = `${label} ${name}`
    const page = pageSchema.parse(
      await api('/api/v2/pages', 'POST', {
        spaceId: input.spaceId,
        status: 'current',
        title,
        ...(parent ? { parentId: parent } : {}),
        body: { representation: 'storage', value: `<p>Orion ${name} before edit.</p>` },
      })
    )
    expect(page.spaceId).toBe(input.spaceId)
    expect(page.title).toBe(title)
    ownedPages.set(page.id, title)
    await api(`/rest/api/content/${page.id}/label`, 'POST', [{ prefix: 'global', name: label }])
    return page.id
  }
  async function restrict(id: string, subjects: string[]) {
    await ownPage(id)
    const accounts = [...new Set([adminSubject, ...subjects])]
    await api(`/rest/api/content/${id}/restriction`, 'PUT', {
      results: [
        {
          operation: 'read',
          restrictions: {
            user: accounts.map((accountId) => ({ type: 'known', accountId })),
            group: [],
          },
        },
        {
          operation: 'update',
          restrictions: {
            user: [{ type: 'known', accountId: adminSubject }],
            group: [],
          },
        },
      ],
    })
    expect(
      new Set(
        (await getReadRestriction(input.cloudId, adminToken, id))?.map((principal) => principal.id)
      )
    ).toEqual(new Set(accounts))
    const { operations } = z
      .object({
        operations: z.array(z.object({ operation: z.string(), targetType: z.string() })),
      })
      .parse(await api(`/api/v2/pages/${id}/operations`))
    expect(
      operations.filter((entry) => entry.targetType === 'page').map((entry) => entry.operation)
    ).toEqual(expect.arrayContaining(['read', 'update', 'restrict_content', 'delete']))
  }
  async function canReadCurrentPage(id: string, token: string) {
    const result = await response(`/api/v2/pages/${id}`, token)
    if (result.ok)
      return z.object({ status: z.string() }).parse(await result.json()).status === 'current'
    if ([403, 404].includes(result.status)) return false
    throw new Error(`Confluence fixture visibility probe: HTTP ${result.status}`)
  }
  async function listed(token: string) {
    const ids = new Set<string>()
    let cursor: string | undefined
    const context = { cloudId: input.cloudId }
    for (let page = 0; page < 10; page++) {
      const result = await confluenceConnector.listDocuments(token, sourceConfig(), cursor, context)
      for (const row of result.documents) {
        if (!ownedPages.has(row.externalId))
          throw new Error('Confluence returned content outside this fixture run')
        ids.add(row.externalId)
      }
      if (!result.hasMore) return ids
      if (!result.nextCursor) throw new Error('Confluence omitted a continuation cursor')
      cursor = result.nextCursor
    }
    throw new Error('Confluence fixture listing exceeded ten pages')
  }
  async function expectNative(firstMemberIds: string[]) {
    const expected = new Set(firstMemberIds)
    for (const id of ownedPages.keys()) {
      expect(
        await canReadCurrentPage(id, members[0].token),
        `native first member / page ${id}`
      ).toBe(expected.has(id))
      if (members[1])
        expect(
          await canReadCurrentPage(id, members[1].token),
          `native outside-space member / page ${id}`
        ).toBe(false)
    }
    await vi.waitFor(
      async () => {
        expect(await listed(adminToken)).toEqual(
          new Set([...ownedPages.keys()].filter((id) => !trashedPages.has(id)))
        )
        expect(await listed(members[0].token)).toEqual(expected)
        if (members[1]) expect(await listed(members[1].token)).toEqual(new Set())
      },
      { timeout: 60000, interval: 1500 }
    )
  }
  async function stored() {
    const rows = await db
      .select()
      .from(document)
      .where(inArray(document.connectorId, [adminConnectorId, memberConnectorId]))
    for (const row of rows) if (row.storageKey) storedKeys.add(row.storageKey)
    return rows
  }
  async function sync() {
    const billingAttribution = await resolveBillingAttribution({
      actorUserId: ownerId,
      workspaceId: input.workspaceId,
    })
    const result = await executeSync(adminConnectorId, { billingAttribution, fullSync: true })
    expect(result.error).toBeUndefined()
    expect(result.skipReason).toBeUndefined()
    expect(result.docsFailed).toBe(0)
    await db
      .update(knowledgeConnectorMember)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(knowledgeConnectorMember.connectorId, memberConnectorId))
    const memberResult = await executeMemberSync(memberConnectorId, {
      billingAttribution,
      forceContentRefresh: true,
    })
    expect(memberResult.error).toBeUndefined()
    expect(memberResult.membersFailed).toBe(0)
    expect(memberResult.docsFailed).toBe(0)
    expect(memberResult.membersRemaining).toBe(false)
    await stored()
  }
  async function assertParity(firstMemberIds: string[]) {
    const rows = await stored()
    for (const row of rows) if (!row.deletedAt) expect(row.processingStatus).toBe('completed')
    for (const member of members) {
      const visible = new Set(member === members[0] ? firstMemberIds : [])
      const expected = new Set(
        rows.filter((row) => !row.deletedAt && visible.has(row.externalId!)).map((row) => row.id)
      )
      const results = await searchKnowledge.execute({
        principal: actor(member.userId),
        input: {
          workspaceId: input.workspaceId,
          knowledgeBaseIds: [kbId],
          query: 'Orion',
          topK: 100,
        },
      })
      expect(new Set(results.results.map((row) => row.documentId))).toEqual(expected)
      for (const row of rows) {
        const read = () =>
          readKnowledgeDocument.execute({
            principal: actor(member.userId),
            input: { knowledgeBaseId: kbId, documentId: row.id },
          })
        const chunks = () =>
          listKnowledgeChunks.execute({
            principal: actor(member.userId),
            input: { knowledgeBaseId: kbId, documentId: row.id },
          })
        const raw = () =>
          downloadFileFromUrl(row.fileUrl, { userId: member.userId, knowledgeAccess: 'user' })
        if (expected.has(row.id)) {
          expect((await read()).document.id).toBe(row.id)
          expect((await chunks()).chunks.length).toBeGreaterThan(0)
          expect((await raw()).length).toBeGreaterThan(0)
        } else {
          await expect(read()).rejects.toThrow('Document not found')
          await expect(chunks()).rejects.toThrow('Document not found')
          await expect(raw()).rejects.toThrow('Access denied')
        }
      }
    }
    const workspaceKey: Principal = {
      kind: 'workspace_api_key',
      workspaceId: input.workspaceId,
      keyId: 'confluence-live',
    }
    expect(
      (
        await searchKnowledge.execute({
          principal: workspaceKey,
          input: {
            workspaceId: input.workspaceId,
            knowledgeBaseIds: [kbId],
            query: 'Orion',
            topK: 100,
          },
        })
      ).results
    ).toEqual([])
  }

  beforeAll(async () => {
    if (!oauthFile) throw new Error('Provide CONFLUENCE_LIVE_OAUTH_FILE for the fixture client')
    const client = z
      .object({
        CONFLUENCE_CLIENT_ID: z.string().min(1),
        CONFLUENCE_CLIENT_SECRET: z.string().min(1),
      })
      .parse(JSON.parse(await readFile(oauthFile, 'utf8')))
    Object.assign(env, client)
    input = fixtureSchema.parse(JSON.parse(await readFile(fixtureFile!, 'utf8')))
    const [base] = await db.select().from(workspace).where(eq(workspace.id, input.workspaceId))
    expect(base?.name).toBe('ACL integration fixture')
    ownerId = base.ownerId
    const [admin] = await db
      .select()
      .from(credential)
      .where(eq(credential.id, input.adminCredentialId))
    expect(admin?.workspaceId).toBe(input.workspaceId)
    expect(admin?.type).toBe('service_account')
    expect(admin?.providerId).toBe(ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID)
    const secret = await getAtlassianServiceAccountSecret(input.adminCredentialId)
    expect(secret.domain).toBe(input.domain)
    expect(secret.cloudId).toBe(input.cloudId)
    const bundle = await resolveCredentialTokenBundle(
      input.adminCredentialId,
      ownerId,
      'confluence-live'
    )
    if (!bundle?.accessToken)
      throw new Error('Connect the fixture Atlassian service account in Sim first')
    adminToken = bundle.accessToken
    const identity = z
      .object({ accountId: z.string().min(1) })
      .parse(await api('/rest/api/user/current'))
    adminSubject = identity.accountId
    expect(adminSubject).toBe(secret.atlassianAccountId)
    const space = z
      .object({
        id: z.string(),
        key: z.string(),
        name: z.string(),
        createdAt: z.string().datetime({ offset: true }),
      })
      .parse(await api(`/api/v2/spaces/${input.spaceId}`))
    expect(space.id).toBe(input.spaceId)
    expect(space.key).toBe(input.spaceKey)
    expect(space.name).toMatch(/^sim-search-e2e-/)
    expect(Date.now() - Date.parse(space.createdAt)).toBeLessThan(24 * 60 * 60 * 1000)
    const existingPages = z
      .object({ results: z.array(z.object({ id: z.string() })) })
      .parse(await api(`/api/v2/spaces/${input.spaceId}/pages?limit=2`))
    expect(
      existingPages.results.length,
      'Use a newly created space containing at most its homepage'
    ).toBeLessThanOrEqual(1)
    for (const credentialId of input.memberCredentialIds) {
      const binding = await loadManagedCredentialGroupBinding(credentialId)
      if (!binding) throw new Error('Connect each fixture human through Connected accounts first')
      expect(binding.workspaceId).toBe(input.workspaceId)
      expect(binding.providerId).toBe('confluence')
      if (groupId) {
        expect(binding.credentialGroupId).toBe(groupId)
        expect(binding.credentialGroupOptionId).toBe(optionId)
      } else {
        groupId = binding.credentialGroupId
        optionId = binding.credentialGroupOptionId
      }
      const [row] = await db
        .select({ credential, email: credentialGroupEnrollment.email })
        .from(credential)
        .innerJoin(
          credentialGroupEnrollment,
          eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
        )
        .where(eq(credential.id, credentialId))
      if (!row.credential.providerSubjectId)
        throw new Error('Fixture member has no verified provider identity')
      expect(row.credential.providerTenantId).toBeNull()
      expect(confluenceSubjectToken(row.credential.providerSubjectId)).toBe(
        subjectToken(row.credential)
      )
      let [person] = await db.select().from(user).where(eq(user.email, row.email))
      if (!person) {
        const id = generateId()
        await db.insert(user).values({
          id,
          email: row.email,
          emailVerified: true,
          name: 'Confluence live fixture',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        createdUsers.push(id)
        ;[person] = await db.select().from(user).where(eq(user.id, id))
      }
      expect(person.emailVerified).toBe(true)
      const membership = await db
        .select({ id: permissions.id })
        .from(permissions)
        .where(
          and(
            eq(permissions.userId, person.id),
            eq(permissions.entityId, input.workspaceId),
            eq(permissions.entityType, 'workspace')
          )
        )
      if (!membership.length) {
        const id = generateId()
        await db.insert(permissions).values({
          id,
          userId: person.id,
          entityId: input.workspaceId,
          entityType: 'workspace',
          permissionType: 'read',
        })
        createdPermissions.push(id)
      }
      await requireCurrentHumanRole(
        person.id,
        {
          workspaceId: input.workspaceId,
          workspaceOrganizationId: base.organizationId,
          allowPersonalApiKeys: base.allowPersonalApiKeys,
        },
        'read'
      )
      members.push({
        credentialId,
        userId: person.id,
        subject: row.credential.providerSubjectId,
        token: '',
      })
    }
    expect(new Set([adminSubject, ...members.map((member) => member.subject)]).size).toBe(
      members.length + 1
    )
    await db.insert(knowledgeBase).values({
      id: kbId,
      userId: ownerId,
      workspaceId: input.workspaceId,
      name: 'Disposable Confluence live verification',
      chunkingConfig: { maxSize: 1024, minSize: 1, overlap: 20 },
    })
    await db.insert(knowledgeConnector).values([
      {
        id: adminConnectorId,
        knowledgeBaseId: kbId,
        connectorType: 'confluence',
        sourceConfig: sourceConfig(),
        accessMode: 'admin',
        credentialId: input.adminCredentialId,
        status: 'active',
      },
      {
        id: memberConnectorId,
        knowledgeBaseId: kbId,
        connectorType: 'confluence',
        sourceConfig: sourceConfig(),
        accessMode: 'members',
        credentialGroupId: groupId,
        credentialGroupOptionId: optionId,
        status: 'active',
        memberSyncStatus: 'idle',
      },
    ])
    await grantKnowledgeConnectorCredentialAccess(scope(), ownerId)
    for (const member of members) {
      member.token = (
        await mintKnowledgeConnectorMemberToken({
          connectorId: memberConnectorId,
          workspaceId: input.workspaceId,
          credentialId: member.credentialId,
          expectedProviderId: 'confluence',
          requiredScopes:
            confluenceConnector.auth.mode === 'oauth'
              ? (confluenceConnector.auth.requiredScopes ?? [])
              : [],
          runId: 'confluence-live',
        })
      ).accessToken
    }
    expect((await response(`/api/v2/spaces/${input.spaceId}`, members[0].token)).status).toBe(200)
    if (members[1])
      expect([403, 404]).toContain(
        (await response(`/api/v2/spaces/${input.spaceId}`, members[1].token)).status
      )
  }, 120000)

  afterAll(async () => {
    const cleanup = await Promise.allSettled([
      (async () => {
        const failures: unknown[] = []
        for (const id of [...ownedPages.keys()].reverse()) {
          if (trashedPages.has(id)) continue
          try {
            await ownPage(id)
            await api(`/api/v2/pages/${id}`, 'DELETE')
            trashedPages.add(id)
          } catch (error) {
            failures.push(error)
          }
        }
        if (failures.length)
          throw new AggregateError(failures, 'Confluence fixture page cleanup failed')
      })(),
      (async () => {
        await stored()
        if (groupId) await revokeKnowledgeConnectorCredentialAccess(scope(), ownerId)
        for (const key of storedKeys) {
          try {
            await deleteFile({ key, context: 'knowledge-base' })
          } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
          }
        }
        await db.delete(knowledgeBase).where(eq(knowledgeBase.id, kbId))
        if (createdPermissions.length)
          await db.delete(permissions).where(inArray(permissions.id, createdPermissions))
        if (createdUsers.length) await db.delete(user).where(inArray(user.id, createdUsers))
      })(),
    ])
    await db.$client.end()
    Object.assign(env, {
      CONFLUENCE_CLIENT_ID: previousClient.id,
      CONFLUENCE_CLIENT_SECRET: previousClient.secret,
    })
    for (const result of cleanup) if (result.status === 'rejected') throw result.reason
  }, 120000)

  it('indexes real pages with mirrored ACLs and managed human listings', async () => {
    openId = await createPage('open')
    parentId = await createPage('parent')
    childId = await createPage('child', parentId)
    await restrict(parentId, [members[0].subject])
    await restrict(childId, [])
    await expectNative([openId, parentId])
    await sync()
    expect(
      (await stored()).filter((row) => row.connectorId === adminConnectorId && !row.deletedAt)
    ).toHaveLength(3)
    expect(
      (await stored()).filter((row) => row.connectorId === memberConnectorId && !row.deletedAt)
    ).toHaveLength(2)
    await assertParity([openId, parentId])
  }, 240000)

  it('applies ancestor revocation even when the unchanged child explicitly allows the reader', async () => {
    await restrict(childId, [members[0].subject])
    await expectNative([openId, parentId, childId])
    await sync()
    await assertParity([openId, parentId, childId])
    const before = await ownPage(childId)
    await restrict(parentId, [])
    expect((await ownPage(childId)).version.number).toBe(before.version.number)
    await expectNative([openId])
    await sync()
    await assertParity([openId])
    await restrict(parentId, [members[0].subject])
    await expectNative([openId, parentId, childId])
    await sync()
    await assertParity([openId, parentId, childId])
  }, 360000)

  it('requires space access even when a page explicitly names the outside-space member', async (context) => {
    if (!members[1]) return context.skip()
    await restrict(openId, [members[0].subject, members[1].subject])
    await expectNative([openId, parentId, childId])
    await sync()
    await assertParity([openId, parentId, childId])
  }, 240000)

  it('reindexes edited content through both real ingestion engines', async () => {
    const page = await ownPage(openId)
    await api(`/api/v2/pages/${openId}`, 'PUT', {
      id: openId,
      status: 'current',
      title: page.title,
      body: { representation: 'storage', value: '<p>Orion EDITED_LIVE_CONFLUENCE_BODY.</p>' },
      version: { number: page.version.number + 1 },
    })
    await expectNative([openId, parentId, childId])
    await sync()
    const rows = (await stored()).filter((row) => row.externalId === openId && !row.deletedAt)
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      const chunks = await db
        .select({ content: embedding.content })
        .from(embedding)
        .where(eq(embedding.documentId, row.id))
      expect(chunks.map((chunk) => chunk.content).join('\n')).toContain(
        'EDITED_LIVE_CONFLUENCE_BODY'
      )
    }
    await assertParity([openId, parentId, childId])
  }, 240000)

  it('removes deleted pages from search, document reads, chunks, and raw downloads', async () => {
    await ownPage(childId)
    await api(`/api/v2/pages/${childId}`, 'DELETE')
    trashedPages.add(childId)
    await expectNative([openId, parentId])
    await sync()
    expect(
      (await stored()).filter((row) => row.externalId === childId && !row.deletedAt)
    ).toHaveLength(0)
    await assertParity([openId, parentId])
  }, 240000)
})
