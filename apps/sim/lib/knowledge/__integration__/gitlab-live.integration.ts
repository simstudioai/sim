/**
 * Opt-in self-hosted GitLab test. GITLAB_LIVE_FIXTURE_FILE contains {url, token,
 * auditorToken?} for a disposable localhost HTTPS instance. The administrator
 * token seeds fixture data; an optional read_api Auditor token exercises the CSV
 * path on a licensed instance. NODE_EXTRA_CA_CERTS must trust its certificate.
 * Provider APIs, encrypted PAT storage, ingestion, Postgres and authorization are
 * real. Model outputs/capacity are substituted; requestContext supplies Next's
 * headers for authenticated route-handler calls. Cleanup removes only fixture
 * resources and files, including the fixture organization and workspace.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { readFile } from 'node:fs/promises'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorPermissionGrant,
  knowledgeConnectorPermissionSnapshot,
  member,
  organization,
  organizationSearchIntegration,
  permissions,
  session,
  user,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { isPlainRecord } from '@sim/utils/object'
import { serializeSignedCookie } from 'better-call'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { EmbedOptions } from '@/lib/embeddings/types'

const fixture = vi.hoisted(() => ({ embeddingCalls: 0 }))
const requestContext = new AsyncLocalStorage<Headers>()
vi.mock('next/headers', () => ({
  headers: async () => requestContext.getStore() ?? new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}))
vi.mock('@/lib/embeddings/client', () => ({
  BYOK_EMBEDDING_CREDENTIAL_REJECTION_MESSAGE: 'Fixture embedding credential rejected',
  EMBEDDING_QUOTA_EXHAUSTED_MESSAGE: 'Fixture embedding quota exhausted',
  EmbeddingOutputLimitError: class extends Error {},
  getEmbeddingAggregateItemLimit: () => 1000,
  isBYOKEmbeddingCredentialRejection: () => false,
  isEmbeddingQuotaExhaustion: () => false,
  embed: () => {
    throw new Error('Unexpected model call in GitLab fixture')
  },
  embedOpenRouter: () => {
    throw new Error('Unexpected model call in GitLab fixture')
  },
  assertKnowledgeEmbeddingCapacity: async () => {},
  embedKnowledge: async (texts: string[], options?: EmbedOptions) => {
    if (options?.taskType !== 'query') fixture.embeddingCalls += 1
    return {
      embeddings: texts.map(() => [1, ...Array<number>(1535).fill(0)]),
      totalTokens: texts.length,
      billableTokens: 0,
      isBYOK: true,
      modelName: 'text-embedding-3-small',
      pricingId: 'text-embedding-3-small',
    }
  },
}))

import type {
  ConnectorData,
  CreateConnectorBody,
  UpdateConnectorBody,
} from '@/lib/api/contracts/knowledge/connectors'
import { decryptApiKey, encryptApiKey } from '@/lib/api-key/crypto'
import {
  resolveBillingAttribution,
  resolveOrganizationBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import { seedKnowledgeAclFixture } from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import { updateKnowledgeConnectorAccess } from '@/lib/knowledge/application/connector-access'
import { updateKnowledgeConnector } from '@/lib/knowledge/application/connectors'
import { readKnowledgeDocument } from '@/lib/knowledge/application/documents'
import { readSearchDocument } from '@/lib/knowledge/application/read-search-document'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { executeSync } from '@/lib/knowledge/connectors/sync-engine'
import * as storage from '@/lib/uploads/core/storage-service'
import { downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'
import { PATCH as updateConnectorRoute } from '@/app/api/knowledge/[id]/connectors/[connectorId]/route'
import { POST as createConnectorRoute } from '@/app/api/knowledge/[id]/connectors/route'
import { gitlabConnector } from '@/connectors/gitlab/gitlab'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

interface GitLabPerson {
  id: number
  email: string
  token: string
  simId: string
}
interface GitLabResource {
  id: number
  iid: number
  slug: string
  path_with_namespace: string
}
const fixtureFile = process.env.GITLAB_LIVE_FIXTURE_FILE

describe.skipIf(!fixtureFile)('live self-hosted GitLab ingestion and permission parity', () => {
  let ids: Awaited<ReturnType<typeof seedKnowledgeAclFixture>>
  let base: string
  let adminToken: string
  let auditorToken: string | undefined
  let groupId: number | undefined
  let projectId: number
  let issueIid: number
  let confidentialIid: number
  let mergeIid: number
  let publicNoteId: number
  const people: Record<string, GitLabPerson> = {}
  const createdUserIds: number[] = []
  const extraSimIds: string[] = []
  let config: Record<string, unknown>
  let adminCookie: string
  let readerCookie: string
  const principal = (person: GitLabPerson): Principal => ({
    kind: 'personal_api_key',
    userId: person.simId,
    keyId: 'gitlab-live-fixture',
  })
  const workspaceKey = (): Principal => ({
    kind: 'workspace_api_key',
    workspaceId: ids.workspaceId,
    keyId: 'gitlab-live-fixture',
  })

  async function waitForProjectAccess(person: GitLabPerson, expectedStatus: number) {
    let status = 0
    const deadline = Date.now() + 300_000
    while (Date.now() < deadline) {
      status = (await response(`/projects/${projectId}`, person.token)).status
      if (status === expectedStatus) return
      await sleep(1000)
    }
    expect(status, 'GitLab project authorization did not converge').toBe(expectedStatus)
  }

  async function response(
    resource: string,
    token = adminToken,
    method = 'GET',
    body?: Record<string, unknown>
  ) {
    return fetch(`${base}/api/v4${resource}`, {
      method,
      headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    })
  }
  async function api<T>(
    resource: string,
    method = 'GET',
    body?: Record<string, unknown>,
    token = adminToken
  ): Promise<T> {
    const result = await response(resource, token, method, body)
    if (!result.ok)
      throw new Error(`Disposable GitLab ${method} ${resource}: HTTP ${result.status}`)
    return result.status === 204 ? (undefined as T) : ((await result.json()) as T)
  }
  async function sync() {
    const result = await executeSync(ids.connectorId, {
      billingAttribution: await resolveBillingAttribution({
        actorUserId: ids.aliceId,
        workspaceId: ids.workspaceId,
      }),
      fullSync: true,
    })
    expect(result.error).toBeUndefined()
    expect(result.docsFailed).toBe(0)
    expect(result.skipReason).toBeUndefined()
    return result
  }
  async function stored() {
    return db
      .select()
      .from(document)
      .where(and(eq(document.connectorId, ids.connectorId), isNull(document.deletedAt)))
  }
  async function storedVectors() {
    const docs = await stored()
    return db
      .select({ id: embedding.id, content: embedding.content })
      .from(embedding)
      .where(
        inArray(
          embedding.documentId,
          docs.map((row) => row.id)
        )
      )
      .orderBy(embedding.id)
  }
  async function search(actor: Principal) {
    const result = await searchKnowledge.execute({
      principal: actor,
      input: {
        workspaceId: ids.workspaceId,
        knowledgeBaseIds: [ids.knowledgeBaseId],
        query: 'Orion',
        topK: 100,
      },
    })
    return new Set(result.results.map((row) => row.documentId))
  }
  function providerPath(externalId: string): string {
    if (externalId.startsWith('file:'))
      return `/projects/${projectId}/repository/files/${encodeURIComponent(externalId.slice(5))}?ref=main`
    if (externalId.startsWith('wiki:'))
      return `/projects/${projectId}/wikis/${encodeURIComponent(externalId.slice(5))}`
    if (externalId.startsWith('issue:'))
      return `/projects/${projectId}/issues/${externalId.slice(6)}`
    if (externalId.startsWith('merge_request:'))
      return `/projects/${projectId}/merge_requests/${externalId.slice(14)}`
    throw new Error('Unexpected live GitLab document type')
  }
  async function assertProviderParity(names: string[]) {
    const docs = await stored()
    expect(docs.length).toBeGreaterThan(3)
    for (const name of names) {
      const person = people[name]
      const results = await search(principal(person))
      for (const doc of docs) {
        const source = await response(providerPath(doc.externalId!), person.token)
        expect([200, 401, 403, 404], `${name}: ${doc.externalId}`).toContain(source.status)
        expect(
          results.has(doc.id),
          `${name}: ${doc.externalId}, GitLab HTTP ${source.status}`
        ).toBe(source.ok)
        const read = readKnowledgeDocument.execute({
          principal: principal(person),
          input: { knowledgeBaseId: ids.knowledgeBaseId, documentId: doc.id },
        })
        if (source.ok) await expect(read).resolves.toBeDefined()
        else await expect(read).rejects.toMatchObject({ code: 'not_found' })
      }
    }
  }

  beforeAll(async () => {
    const access: unknown = JSON.parse(await readFile(fixtureFile!, 'utf8'))
    if (
      !isPlainRecord(access) ||
      typeof access.url !== 'string' ||
      !/^https:\/\/localhost:\d+$/.test(access.url) ||
      typeof access.token !== 'string'
    )
      throw new Error('Only the explicit disposable localhost GitLab fixture is supported')
    base = access.url
    adminToken = access.token
    auditorToken = typeof access.auditorToken === 'string' ? access.auditorToken : undefined
    ids = await seedKnowledgeAclFixture()
    async function sessionCookie(userId: string) {
      const token = generateId()
      await db.insert(session).values({
        id: generateId(),
        token,
        userId,
        expiresAt: new Date(Date.now() + 3_600_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      return (
        await serializeSignedCookie(
          'better-auth.session_token',
          token,
          process.env.BETTER_AUTH_SECRET!
        )
      ).split(';')[0]
    }
    adminCookie = await sessionCookie(ids.aliceId)
    readerCookie = await sessionCookie(ids.bobId)
    const suffix = generateId().replaceAll('-', '')
    const group = await api<GitLabResource>('/groups', 'POST', {
      name: `Sim Search E2E ${suffix}`,
      path: `sim-search-e2e-${suffix}`,
      visibility: 'public',
    })
    groupId = group.id
    const project = await api<GitLabResource>('/projects', 'POST', {
      name: 'Orion search fixture',
      path: 'orion',
      namespace_id: group.id,
      visibility: 'private',
      initialize_with_readme: false,
      default_branch: 'main',
    })
    projectId = project.id
    config = { host: new URL(base).host, project: project.path_with_namespace, contentTypes: 'all' }
    for (const [name, role] of [
      ['reporter', 20],
      ['guest', 10],
      ['planner', 15],
      ['outsider', 0],
      ['external', 0],
    ] as const) {
      const simId = name === 'reporter' ? ids.aliceId : name === 'guest' ? ids.bobId : generateId()
      if (!['reporter', 'guest'].includes(name)) {
        extraSimIds.push(simId)
        await db.insert(user).values({
          id: simId,
          name: `${name} fixture`,
          email: `${simId}@fixture.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        await db.insert(permissions).values({
          id: generateId(),
          userId: simId,
          entityType: 'workspace',
          entityId: ids.workspaceId,
          permissionType: 'read',
        })
      }
      const person = await api<{ id: number; email: string }>('/users', 'POST', {
        email: `${simId}@fixture.test`,
        username: `${name}-${suffix}`,
        name: `${name} fixture`,
        password: `${generateId()}Aa1!`,
        skip_confirmation: true,
        external: name === 'external',
      })
      createdUserIds.push(person.id)
      const credential = await api<{ token: string }>(
        `/users/${person.id}/personal_access_tokens`,
        'POST',
        {
          name: 'Disposable search test',
          scopes: ['read_api'],
          expires_at: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        }
      )
      people[name] = { ...person, token: credential.token, simId }
      if (role)
        await api(`/groups/${group.id}/members`, 'POST', { user_id: person.id, access_level: role })
    }
    await api(`/projects/${project.id}/repository/files/orion.md`, 'POST', {
      branch: 'main',
      content: 'Orion repository: search fixture with verified access controls.',
      commit_message: 'Create disposable search fixture',
    })
    await api(`/projects/${project.id}/wikis`, 'POST', {
      title: 'Orion wiki',
      content: 'Orion wiki: release checklist and source permissions.',
      format: 'markdown',
    })
    const issue = await api<GitLabResource>(`/projects/${project.id}/issues`, 'POST', {
      title: 'Orion issue',
      description: 'Orion normal issue body.',
    })
    issueIid = issue.iid
    const confidential = await api<GitLabResource>(`/projects/${project.id}/issues`, 'POST', {
      title: 'Orion confidential',
      description: 'Orion confidential issue body.',
      confidential: true,
    })
    confidentialIid = confidential.iid
    const note = await api<{ id: number }>(
      `/projects/${project.id}/issues/${issue.iid}/notes`,
      'POST',
      { body: 'Orion public reply before editing.' }
    )
    publicNoteId = note.id
    await api(`/projects/${project.id}/issues/${issue.iid}/notes`, 'POST', {
      body: 'INTERNAL_FIXTURE_NOTE_MUST_NOT_BE_INDEXED',
      internal: true,
    })
    await api(`/projects/${project.id}/repository/branches`, 'POST', {
      branch: 'fixture-change',
      ref: 'main',
    })
    await api(`/projects/${project.id}/repository/files/orion.md`, 'PUT', {
      branch: 'fixture-change',
      content: 'Orion changed repository.',
      commit_message: 'Disposable proposed change',
    })
    const merge = await api<GitLabResource>(`/projects/${project.id}/merge_requests`, 'POST', {
      source_branch: 'fixture-change',
      target_branch: 'main',
      title: 'Orion merge request',
      description: 'Orion proposed change.',
    })
    mergeIid = merge.iid
    await api(`/projects/${project.id}/merge_requests/${merge.iid}/notes`, 'POST', {
      body: 'Orion merge review comment.',
    })
    await db
      .update(knowledgeConnector)
      .set({
        connectorType: 'gitlab',
        sourceConfig: config,
        accessMode: 'admin',
        status: 'active',
        syncLockToken: null,
        encryptedApiKey: (await encryptApiKey(adminToken)).encrypted,
      })
      .where(eq(knowledgeConnector.id, ids.connectorId))
  }, 600000)

  afterAll(async () => {
    const cleanup = await Promise.allSettled([
      (async () => {
        if (groupId) await api(`/groups/${groupId}`, 'DELETE')
        for (const id of createdUserIds) await api(`/users/${id}?hard_delete=true`, 'DELETE')
      })(),
      (async () => {
        if (ids) {
          const files = await db
            .select({ key: workspaceFiles.key })
            .from(workspaceFiles)
            .where(
              or(
                eq(workspaceFiles.workspaceId, ids.workspaceId),
                eq(workspaceFiles.organizationId, ids.organizationId)
              )
            )
          for (const file of files) {
            try {
              await storage.deleteFile({ key: file.key, context: 'knowledge-base' })
            } catch (error) {
              if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
                throw error
            }
          }
          await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
          await db.delete(organization).where(eq(organization.id, ids.organizationId))
          await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId, ...extraSimIds]))
        }
      })(),
    ])
    await db.$client.end()
    for (const outcome of cleanup) if (outcome.status === 'rejected') throw outcome.reason
  }, 120000)

  it('validates a custom HTTPS instance and ingests repository, wiki, issues and merge requests through the real engine', async () => {
    for (const person of [people.reporter, people.guest, people.planner]) {
      await waitForProjectAccess(person, 200)
    }
    expect(await gitlabConnector.validateConfig!(adminToken, config)).toEqual({ valid: true })
    expect(
      await gitlabConnector.validateConfig!(adminToken, config, { mirrorsSourceAcls: true })
    ).toEqual({ valid: true })
    expect(
      await gitlabConnector.validateConfig!(people.reporter.token, config, {
        mirrorsSourceAcls: true,
      })
    ).toMatchObject({ valid: false, error: expect.stringContaining('administrator') })
    const result = await sync()
    expect(result.docsAdded).toBe(5)
    const docs = await stored()
    expect(
      docs
        .filter((row) => row.processingStatus !== 'completed')
        .map((row) => ({
          externalId: row.externalId,
          status: row.processingStatus,
          error: row.processingError,
        }))
    ).toEqual([])
    expect(docs.map((row) => row.externalId)).toEqual(
      expect.arrayContaining([
        'file:orion.md',
        'wiki:Orion-wiki',
        `issue:${issueIid}`,
        `issue:${confidentialIid}`,
        `merge_request:${mergeIid}`,
      ])
    )
    const content = (await storedVectors()).map((row) => row.content).join('\n')
    expect(content).toContain('Orion public reply before editing.')
    expect(content).toContain('Orion merge review comment.')
    expect(content).not.toContain('INTERNAL_FIXTURE_NOTE_MUST_NOT_BE_INDEXED')
    expect(await search(workspaceKey())).toEqual(new Set())
  }, 600000)

  it('matches GitLab private-project decisions for inherited Reporter, Guest, Planner, outside and external users', async () => {
    await assertProviderParity(['reporter', 'guest', 'planner', 'outsider', 'external'])
    const file = (await stored()).find((row) => row.externalId === 'file:orion.md')!
    await expect(
      listKnowledgeChunks.execute({
        principal: principal(people.guest),
        input: { knowledgeBaseId: ids.knowledgeBaseId, documentId: file.id, limit: 10, offset: 0 },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      downloadFileFromUrl(file.fileUrl!, { userId: people.guest.simId, knowledgeAccess: 'user' })
    ).rejects.toBeDefined()
  }, 120000)

  it('revokes inherited repository access and grants confidential assignee access without changing embeddings', async () => {
    const before = await storedVectors()
    await api(`/groups/${groupId}/members/${people.reporter.id}`, 'PUT', { access_level: 10 })
    await api(`/projects/${projectId}/issues/${confidentialIid}`, 'PUT', {
      assignee_ids: [people.guest.id],
    })
    await sync()
    expect(await storedVectors()).toEqual(before)
    await assertProviderParity(['reporter', 'guest'])
    await api(`/groups/${groupId}/members/${people.guest.id}`, 'DELETE')
    await waitForProjectAccess(people.guest, 404)
    await sync()
    await assertProviderParity(['guest'])
    await api(`/groups/${groupId}/members`, 'POST', { user_id: people.guest.id, access_level: 10 })
    await api(`/projects/${projectId}/issues/${confidentialIid}`, 'PUT', {
      assignee_ids: [people.guest.id],
    })
    await api(`/groups/${groupId}/members/${people.reporter.id}`, 'PUT', { access_level: 20 })
    await waitForProjectAccess(people.guest, 200)
  }, 600000)

  it('indexes edited comments and updates confidential permissions on an unchanged issue body', async () => {
    await api(`/projects/${projectId}/issues/${issueIid}/notes/${publicNoteId}`, 'PUT', {
      body: 'Orion public reply after editing.',
    })
    await api(`/projects/${projectId}/issues/${issueIid}`, 'PUT', { confidential: true })
    await sync()
    const content = (await storedVectors()).map((row) => row.content).join('\n')
    expect(content).toContain('Orion public reply after editing.')
    expect(content).not.toContain('Orion public reply before editing.')
    await assertProviderParity(['reporter', 'guest', 'planner'])
  }, 120000)

  it('matches public/internal visibility, private repository features, and blocked users', async () => {
    for (const visibility of ['private', 'public', 'internal'] as const) {
      await api(`/projects/${projectId}`, 'PUT', { visibility })
      await sync()
      await assertProviderParity(['guest', 'planner', 'outsider', 'external'])
      await api(`/projects/${projectId}`, 'PUT', {
        repository_access_level: 'private',
        merge_requests_access_level: 'private',
        builds_access_level: 'private',
      })
      await sync()
      await assertProviderParity(['reporter', 'guest', 'planner', 'outsider', 'external'])
      await api(`/projects/${projectId}`, 'PUT', {
        repository_access_level: 'enabled',
        merge_requests_access_level: 'enabled',
        builds_access_level: 'enabled',
      })
    }
    await api(`/users/${people.reporter.id}/block`, 'POST')
    await sync()
    await assertProviderParity(['reporter'])
    await api(`/users/${people.reporter.id}/unblock`, 'POST')
  }, 180000)

  it('rejects new workspace sharing and upgrades legacy GitLab connections with immediate authorization changes', async () => {
    const scope = {
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorId: ids.connectorId,
      assertedWorkspaceId: ids.workspaceId,
    }
    const actor: Principal = {
      kind: 'session',
      userId: ids.aliceId,
      sessionId: 'gitlab-live-fixture',
    }
    await expect(
      updateKnowledgeConnectorAccess.execute({
        principal: principal(people.guest),
        input: { ...scope, accessMode: 'workspace' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    await updateKnowledgeConnector.execute({
      principal: actor,
      input: { ...scope, updates: { status: 'paused' } },
    })
    const before = await storedVectors()
    await expect(
      updateKnowledgeConnectorAccess.execute({
        principal: actor,
        input: { ...scope, accessMode: 'workspace' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    await db
      .update(knowledgeConnector)
      .set({ accessMode: 'workspace' })
      .where(eq(knowledgeConnector.id, ids.connectorId))
    await db
      .update(document)
      .set({ acl: ['ws'], aclRequirements: [] })
      .where(eq(document.connectorId, ids.connectorId))
    expect(await search(workspaceKey())).toEqual(new Set((await stored()).map((row) => row.id)))
    await updateKnowledgeConnectorAccess.execute({
      principal: actor,
      input: { ...scope, accessMode: 'admin' },
    })
    expect(await search(workspaceKey())).toEqual(new Set())
    expect(await search(principal(people.reporter))).toEqual(new Set())
    expect(await storedVectors()).toEqual(before)
    await updateKnowledgeConnector.execute({
      principal: actor,
      input: { ...scope, updates: { status: 'active' } },
    })
    await sync()
    await assertProviderParity(['reporter', 'guest', 'outsider'])
    expect(await search(workspaceKey())).toEqual(new Set())
  }, 120000)

  it('reconciles a narrowed repository scope and a file deleted upstream', async () => {
    const scope = {
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorId: ids.connectorId,
      assertedWorkspaceId: ids.workspaceId,
    }
    const actor: Principal = {
      kind: 'session',
      userId: ids.aliceId,
      sessionId: 'gitlab-live-fixture',
    }
    await updateKnowledgeConnector.execute({
      principal: actor,
      input: { ...scope, updates: { status: 'paused' } },
    })
    await updateKnowledgeConnector.execute({
      principal: actor,
      input: {
        ...scope,
        updates: {
          sourceConfig: { ...config, contentTypes: 'repo', ref: 'main', fileExtensions: '.md' },
        },
      },
    })
    await updateKnowledgeConnector.execute({
      principal: actor,
      input: { ...scope, updates: { status: 'active' } },
    })
    await sync()
    expect((await stored()).map((row) => row.externalId)).toEqual(['file:orion.md'])
    await api(`/projects/${projectId}/repository/files/orion.md`, 'DELETE', {
      branch: 'main',
      commit_message: 'Delete disposable search fixture',
    })
    await sync()
    expect(await stored()).toEqual([])
    expect(await search(principal(people.reporter))).toEqual(new Set())
  }, 120000)

  async function connectorRequest(
    knowledgeBaseId: string,
    body: CreateConnectorBody | UpdateConnectorBody,
    connectorId?: string,
    cookie = adminCookie
  ) {
    const headers = new Headers({
      cookie,
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
    })
    const path = `/api/knowledge/${knowledgeBaseId}/connectors${connectorId ? `/${connectorId}` : ''}`
    const request = new NextRequest(`http://localhost:3000${path}`, {
      method: connectorId ? 'PATCH' : 'POST',
      headers,
      body: JSON.stringify(body),
    })
    return requestContext.run(headers, async () =>
      connectorId
        ? updateConnectorRoute(request, {
            params: Promise.resolve({ id: knowledgeBaseId, connectorId }),
          })
        : createConnectorRoute(request, { params: Promise.resolve({ id: knowledgeBaseId }) })
    )
  }

  async function waitForSync(connectorId: string) {
    for (let attempt = 0; attempt < 600; attempt++) {
      const [row] = await db
        .select()
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, connectorId))
      if (row && !['syncing', 'pending'].includes(row.status)) {
        expect(row.lastSyncError).toBeNull()
        return row
      }
      await sleep(100)
    }
    throw new Error('Disposable connector sync did not finish within one minute')
  }

  it.each([false, true])(
    'enforces non-admin CSV permissions through authenticated API, indexing and every read surface (Search=%s)',
    async (isSearchIndex) => {
      await api(`/projects/${projectId}`, 'PUT', { visibility: 'private' })
      await api(`/projects/${projectId}/issues/${issueIid}`, 'PUT', { confidential: false })
      const owner = isSearchIndex
        ? { organizationId: ids.organizationId }
        : { workspaceId: ids.workspaceId }
      if (isSearchIndex) {
        await db.insert(member).values(
          Object.values(people).map((person) => ({
            id: generateId(),
            userId: person.simId,
            organizationId: ids.organizationId,
            role: person.simId === ids.aliceId ? 'owner' : 'member',
            createdAt: new Date(),
          }))
        )
        await db
          .insert(organizationSearchIntegration)
          .values({ organizationId: ids.organizationId, connectorType: 'gitlab', approved: true })
      }
      const attribution = isSearchIndex
        ? await resolveOrganizationBillingAttribution({
            actorUserId: ids.aliceId,
            organizationId: ids.organizationId,
          })
        : await resolveBillingAttribution({
            actorUserId: ids.aliceId,
            workspaceId: ids.workspaceId,
          })
      const knowledgeBaseId = generateId()
      await db.insert(knowledgeBase).values({
        id: knowledgeBaseId,
        userId: ids.aliceId,
        ...owner,
        name: `CSV live fixture ${isSearchIndex ? 'Search' : 'KB'}`,
        isSearchIndex,
        chunkingConfig: { maxSize: 1024, minSize: 1, overlap: 20 },
      })
      const mapping = {
        filename: 'users.csv',
        content: `user_id,email\n${people.reporter.id},${people.reporter.email}\n${people.guest.id},${people.guest.email}\n`,
      }
      const projectPermissions = (userId: number) => ({
        filename: 'permissions.csv',
        content: `project_path,user_id\n${config.project},${userId}\nunrelated/project,${people.guest.id}\n${config.project},999999999\n`,
      })
      if (!auditorToken) await waitForProjectAccess(people.reporter, 200)
      const indexingToken = auditorToken ?? people.reporter.token
      const createBody: CreateConnectorBody = {
        connectorType: 'gitlab',
        accessMode: 'admin',
        apiKey: indexingToken,
        sourceConfig: { ...config, contentTypes: 'issues' },
        syncIntervalMinutes: 60,
        permissionConfig: {
          provider: 'gitlab',
          mode: 'csv',
          userMapping: mapping,
          projectPermissions: projectPermissions(people.reporter.id),
        },
      }
      const denied = await connectorRequest(knowledgeBaseId, createBody, undefined, readerCookie)
      expect(denied.status).toBe(403)
      const unsupported = await connectorRequest(knowledgeBaseId, {
        ...createBody,
        accessMode: 'workspace',
      })
      expect(unsupported.status).toBe(400)
      const inaccessibleProject = await connectorRequest(knowledgeBaseId, {
        ...createBody,
        sourceConfig: { ...createBody.sourceConfig, project: 'missing-fixture-project' },
      })
      expect(inaccessibleProject.status).toBe(400)
      const createdResponse = await connectorRequest(knowledgeBaseId, createBody)
      const created = await createdResponse.json()
      expect(createdResponse.status, JSON.stringify(created)).toBe(201)
      let connector = created.data as ConnectorData
      expect(connector.permissionConfig).toMatchObject({
        provider: 'gitlab',
        mode: 'csv',
        revision: 1,
        userMapping: { rowCount: 2 },
      })
      expect(JSON.stringify(created)).not.toContain(indexingToken)
      expect(JSON.stringify(created)).not.toContain(people.reporter.email)
      expect(connector.sourceConfig).not.toHaveProperty('permissionConfig')
      const storedConnector = await waitForSync(connector.id)
      expect(storedConnector.encryptedApiKey).not.toBe(indexingToken)
      expect(
        (await decryptApiKey(storedConnector.encryptedApiKey!)).decrypted === indexingToken
      ).toBe(true)
      const docs = await db.select().from(document).where(eq(document.connectorId, connector.id))
      const ordinary = docs.find((doc) => doc.externalId === `issue:${issueIid}`)!
      expect(ordinary.processingStatus).toBe('completed')
      const excluded = docs.find((doc) => doc.externalId === `issue:${confidentialIid}`)
      if (excluded) {
        expect(excluded.acl).toEqual([])
        expect(excluded.storageKey).toBeNull()
      }
      const searchFor = async (person: GitLabPerson) =>
        (
          await searchKnowledge.execute({
            principal: principal(person),
            input: {
              ...owner,
              knowledgeBaseIds: [knowledgeBaseId],
              query: 'Orion',
              topK: 100,
            },
          })
        ).results.map((row) => row.documentId)
      const assertReads = async (person: GitLabPerson, allowed: boolean) => {
        expect((await searchFor(person)).includes(ordinary.id)).toBe(allowed)
        const operations: Array<() => Promise<unknown>> = [
          () =>
            readKnowledgeDocument.execute({
              principal: principal(person),
              input: { knowledgeBaseId, documentId: ordinary.id },
            }),
          () =>
            listKnowledgeChunks.execute({
              principal: principal(person),
              input: { knowledgeBaseId, documentId: ordinary.id, limit: 10, offset: 0 },
            }),
        ]
        const download = () =>
          downloadFileFromUrl(ordinary.fileUrl!, { userId: person.simId, knowledgeAccess: 'user' })
        if (isSearchIndex) {
          await expect(download()).rejects.toThrow('Access denied')
          operations.push(() =>
            readSearchDocument.execute({
              principal: principal(person),
              input: {
                documentId: ordinary.id,
                assertedOrganizationId: ids.organizationId,
                limit: 3,
                resultSecretRegistry: new ResolvedSecretTraceRegistry(),
              },
            })
          )
        } else operations.push(download)
        for (const operation of operations) {
          if (allowed) await expect(operation()).resolves.toBeDefined()
          else await expect(operation()).rejects.toBeDefined()
        }
      }
      await assertReads(people.reporter, true)
      await assertReads(people.guest, false)
      await assertReads(people.outsider, false)
      const vectors = await db
        .select({ content: embedding.content })
        .from(embedding)
        .where(eq(embedding.documentId, ordinary.id))
      expect(vectors.map((row) => row.content).join('\n')).not.toContain(
        'INTERNAL_FIXTURE_NOTE_MUST_NOT_BE_INDEXED'
      )
      const before = fixture.embeddingCalls
      const tooLarge = await connectorRequest(
        knowledgeBaseId,
        {
          permissionConfig: {
            provider: 'gitlab',
            mode: 'csv',
            expectedRevision: 1,
            userMapping: { filename: 'large.csv', content: 'x'.repeat(4 * 1024 * 1024 + 1) },
          },
        },
        connector.id
      )
      expect(tooLarge.status).toBe(400)
      const overRequestLimit = await connectorRequest(
        knowledgeBaseId,
        {
          sourceConfig: { description: 'x'.repeat(10 * 1024 * 1024) },
        },
        connector.id
      )
      expect(overRequestLimit.status).toBe(413)
      const invalid = await connectorRequest(
        knowledgeBaseId,
        {
          permissionConfig: {
            provider: 'gitlab',
            mode: 'csv',
            expectedRevision: 1,
            userMapping: { filename: 'bad.csv', content: '1,not-an-email' },
          },
        },
        connector.id
      )
      expect(invalid.status).toBe(400)
      await assertReads(people.reporter, true)
      const replace = await connectorRequest(
        knowledgeBaseId,
        {
          permissionConfig: {
            provider: 'gitlab',
            mode: 'csv',
            expectedRevision: 1,
            projectPermissions: projectPermissions(people.guest.id),
          },
        },
        connector.id
      )
      expect(replace.status).toBe(200)
      connector = (await replace.json()).data
      expect(connector.permissionConfig?.revision).toBe(2)
      await assertReads(people.reporter, false)
      await assertReads(people.guest, true)
      expect(fixture.embeddingCalls).toBe(before)
      const stale = await connectorRequest(
        knowledgeBaseId,
        {
          permissionConfig: {
            provider: 'gitlab',
            mode: 'csv',
            expectedRevision: 1,
            projectPermissions: projectPermissions(people.reporter.id),
          },
        },
        connector.id
      )
      expect(stale.status).toBe(409)
      const concurrent = await Promise.all(
        [people.reporter, people.guest].map((person) =>
          connectorRequest(
            knowledgeBaseId,
            {
              permissionConfig: {
                provider: 'gitlab',
                mode: 'csv',
                expectedRevision: 2,
                projectPermissions: projectPermissions(person.id),
              },
            },
            connector.id
          )
        )
      )
      expect(concurrent.map((result) => result.status).sort()).toEqual([200, 409])
      const grants = await db
        .select()
        .from(knowledgeConnectorPermissionGrant)
        .where(eq(knowledgeConnectorPermissionGrant.connectorId, connector.id))
      expect(grants).toHaveLength(1)
      let winner =
        grants[0].subjectToken === `u:${people.reporter.email}` ? people.reporter : people.guest
      await assertReads(winner, true)
      expect(fixture.embeddingCalls).toBe(before)
      await db.update(user).set({ emailVerified: false }).where(eq(user.id, winner.simId))
      await assertReads(winner, false)
      await db.update(user).set({ emailVerified: true }).where(eq(user.id, winner.simId))
      const removedMember = winner
      const newlyMappedMember = winner === people.reporter ? people.guest : people.reporter
      const remapped = await connectorRequest(
        knowledgeBaseId,
        {
          permissionConfig: {
            provider: 'gitlab',
            mode: 'csv',
            expectedRevision: 3,
            userMapping: {
              filename: 'replacement-users.csv',
              content: `${winner.id},${newlyMappedMember.email}`,
            },
          },
        },
        connector.id
      )
      expect(remapped.status).toBe(200)
      await assertReads(removedMember, false)
      winner = newlyMappedMember
      await assertReads(winner, true)
      expect(fixture.embeddingCalls).toBe(before)
      const crossOwner = await connectorRequest(
        ids.knowledgeBaseId,
        {
          permissionConfig: {
            provider: 'gitlab',
            mode: 'csv',
            expectedRevision: 3,
            projectPermissions: projectPermissions(people.reporter.id),
          },
        },
        connector.id
      )
      expect(crossOwner.status).toBe(404)
      await api(`/projects/${projectId}/issues/${issueIid}`, 'PUT', { confidential: true })
      const syncResult = await executeSync(connector.id, {
        billingAttribution: attribution,
        fullSync: true,
      })
      expect(syncResult.docsFailed).toBe(0)
      await assertReads(winner, false)
      const [removed] = await db.select().from(document).where(eq(document.id, ordinary.id))
      expect(removed.storageKey).toBeNull()
      expect(removed.acl).toEqual([])
      expect(
        await db.select().from(embedding).where(eq(embedding.documentId, ordinary.id))
      ).toEqual([])
      const [snapshot] = await db
        .select()
        .from(knowledgeConnectorPermissionSnapshot)
        .where(eq(knowledgeConnectorPermissionSnapshot.connectorId, connector.id))
      expect(snapshot.revision).toBe(4)
      await connectorRequest(knowledgeBaseId, { status: 'paused' }, connector.id)
      const switched = await connectorRequest(
        knowledgeBaseId,
        {
          apiKey: adminToken,
          permissionConfig: { provider: 'gitlab', mode: 'administrator', expectedRevision: 4 },
        },
        connector.id
      )
      expect(switched.status).toBe(200)
      expect((await switched.json()).data.accessRewritePending).toBe(true)
      await assertReads(winner, false)
      await connectorRequest(knowledgeBaseId, { status: 'active' }, connector.id)
      await executeSync(connector.id, {
        billingAttribution: attribution,
        fullSync: true,
      })
      const [restored] = await db
        .select()
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, connector.id))
      expect(restored.accessRewritePending).toBe(false)
    },
    180000
  )
})
