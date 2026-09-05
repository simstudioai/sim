/**
 * Opt-in self-hosted GitLab test. GITLAB_LIVE_FIXTURE_FILE contains {url, token}
 * for a disposable instance at https://localhost:8443; NODE_EXTRA_CA_CERTS must
 * trust its fixture certificate. Uses real provider APIs, encrypted PAT storage,
 * sync engines, parsing, Postgres, and application authorization. Only embeddings
 * are substituted. Only this fixture workspace's stored files are removed afterward.
 */
import { readFile } from 'node:fs/promises'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeConnector,
  permissions,
  user,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { isPlainRecord } from '@sim/utils/object'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ embeddingCalls: 0 }))
vi.mock('@/lib/embeddings', async () => ({
  ...(await import('@/lib/embeddings/client')),
  assertKnowledgeEmbeddingCapacity: async () => {},
  embedKnowledge: async (texts: string[]) => {
    fixture.embeddingCalls += 1
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

import { encryptApiKey } from '@/lib/api-key/crypto'
import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { seedKnowledgeAclFixture } from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import { updateKnowledgeConnectorAccess } from '@/lib/knowledge/application/connector-access'
import { updateKnowledgeConnector } from '@/lib/knowledge/application/connectors'
import { readKnowledgeDocument } from '@/lib/knowledge/application/documents'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { executeSync } from '@/lib/knowledge/connectors/sync-engine'
import * as storage from '@/lib/uploads/core/storage-service'
import { downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'
import { gitlabConnector } from '@/connectors/gitlab/gitlab'

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
      access.url !== 'https://localhost:8443' ||
      typeof access.token !== 'string'
    )
      throw new Error('Only the explicit disposable localhost GitLab fixture is supported')
    base = access.url
    adminToken = access.token
    ids = await seedKnowledgeAclFixture()
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
    config = { host: 'localhost:8443', project: project.path_with_namespace, contentTypes: 'all' }
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
          scopes: ['api'],
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
  }, 180000)

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
            .where(eq(workspaceFiles.workspaceId, ids.workspaceId))
          for (const file of files) {
            try {
              await storage.deleteFile({ key: file.key, context: 'knowledge-base' })
            } catch (error) {
              if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
                throw error
            }
          }
          await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
          await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId, ...extraSimIds]))
        }
      })(),
    ])
    await db.$client.end()
    for (const outcome of cleanup) if (outcome.status === 'rejected') throw outcome.reason
  }, 120000)

  it('validates a custom HTTPS instance and ingests repository, wiki, issues and merge requests through the real engine', async () => {
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
  }, 120000)

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
    await sync()
    await assertProviderParity(['guest'])
    await api(`/groups/${groupId}/members`, 'POST', { user_id: people.guest.id, access_level: 10 })
    await api(`/projects/${projectId}/issues/${confidentialIid}`, 'PUT', {
      assignee_ids: [people.guest.id],
    })
    await api(`/groups/${groupId}/members/${people.reporter.id}`, 'PUT', { access_level: 20 })
  }, 120000)

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

  it('switches between explicit workspace sharing and mirrored access with immediate authorization changes', async () => {
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
    const shared = await updateKnowledgeConnectorAccess.execute({
      principal: actor,
      input: { ...scope, accessMode: 'workspace' },
    })
    expect(shared.changed).toBe(true)
    expect(await search(workspaceKey())).toEqual(new Set((await stored()).map((row) => row.id)))
    expect(
      (
        await updateKnowledgeConnectorAccess.execute({
          principal: actor,
          input: { ...scope, accessMode: 'workspace' },
        })
      ).changed
    ).toBe(false)
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
})
