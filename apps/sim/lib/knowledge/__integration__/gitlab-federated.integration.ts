/**
 * Opt-in provider/API and PostgreSQL coverage for federated GitLab Search.
 * GITLAB_LIVE_FIXTURE_FILE contains {url, token} for a disposable localhost HTTPS
 * GitLab instance; NODE_EXTRA_CA_CERTS trusts its certificate. Uses the isolated
 * database from `bun run test:integration` and deletes only resources it creates.
 */
import { readFile } from 'node:fs/promises'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  document,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorSyncLog,
  knowledgeExternalGroup,
  member,
  organization,
  organizationSearchIntegration,
  user,
  workspace,
} from '@sim/db/schema'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { isPlainRecord } from '@sim/utils/object'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedKnowledgeAclFixture } from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import {
  createKnowledgeConnector,
  updateKnowledgeConnector,
} from '@/lib/knowledge/application/connectors'
import { refreshConnectorDirectory } from '@/lib/knowledge/connectors/external-group-sync'
import {
  decodeLiveReference,
  encodeLiveReference,
  readLiveDocument,
  searchLiveKnowledge,
} from '@/lib/sim-search/live/application'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

interface FixturePerson {
  id: number
  email: string
  simId: string
  token: string
}

const fixtureFile = process.env.GITLAB_LIVE_FIXTURE_FILE
const QUERY = 'AtlasFederatedFixture'

describe.skipIf(!fixtureFile)('federated self-hosted GitLab Search', () => {
  let ids: Awaited<ReturnType<typeof seedKnowledgeAclFixture>>
  let base: string
  let adminToken: string
  let groupId: number | undefined
  let projectId: number
  let projectPath: string
  let connectorId: string
  let issueIid: number
  let confidentialIid: number
  let sourceRevision: number
  const people: Record<string, FixturePerson> = {}
  const providerUserIds: number[] = []
  const simUserIds: string[] = []
  const principal = (person: FixturePerson): Principal => ({
    kind: 'personal_api_key',
    userId: person.simId,
    keyId: 'gitlab-federated-fixture',
  })

  async function response(
    path: string,
    token = adminToken,
    method = 'GET',
    body?: Record<string, unknown>
  ) {
    return fetch(`${base}/api/v4${path}`, {
      method,
      headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    })
  }

  async function api<T>(path: string, method = 'GET', body?: Record<string, unknown>): Promise<T> {
    const result = await response(path, adminToken, method, body)
    if (!result.ok) throw new Error(`Disposable GitLab ${method} ${path}: HTTP ${result.status}`)
    return result.status === 204 ? (undefined as T) : ((await result.json()) as T)
  }

  async function waitForProject(person: FixturePerson, status: number) {
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      if ((await response(`/projects/${projectId}`, person.token)).status === status) return
      await sleep(500)
    }
    throw new Error('Disposable GitLab membership did not converge')
  }

  function search(person: FixturePerson, kind: 'issues' | 'code' | 'wiki' | 'merge_requests') {
    return searchLiveKnowledge.execute({
      principal: principal(person),
      input: {
        organizationId: ids.organizationId,
        query: QUERY,
        topK: 20,
        filters: { source: 'gitlab' },
        nativeQueries: [
          {
            provider: 'gitlab',
            accountId: `gitlab-source:${connectorId}`,
            project: String(projectId),
            kind,
            query: QUERY,
          },
        ],
        resultSecretRegistry: new ResolvedSecretTraceRegistry(),
      },
    })
  }

  function read(person: FixturePerson, documentId: string) {
    return readLiveDocument.execute({
      principal: principal(person),
      input: {
        organizationId: ids.organizationId,
        documentId,
        limit: 3,
        resultSecretRegistry: new ResolvedSecretTraceRegistry(),
      },
    })
  }

  function documentForReader(documentId: string, person: FixturePerson) {
    return encodeLiveReference({ ...decodeLiveReference(documentId), user: person.simId })
  }

  beforeAll(async () => {
    const fixture: unknown = JSON.parse(await readFile(fixtureFile!, 'utf8'))
    if (
      !isPlainRecord(fixture) ||
      typeof fixture.url !== 'string' ||
      !/^https:\/\/localhost:\d+$/.test(fixture.url) ||
      typeof fixture.token !== 'string'
    )
      throw new Error('Only the explicit disposable localhost GitLab fixture is supported')
    base = fixture.url
    adminToken = fixture.token
    ids = await seedKnowledgeAclFixture()
    await db.delete(knowledgeConnector).where(eq(knowledgeConnector.id, ids.connectorId))
    await db
      .update(knowledgeBase)
      .set({ workspaceId: null, organizationId: ids.organizationId, isSearchIndex: true })
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    const suffix = generateId().replaceAll('-', '')
    const group = await api<{ id: number }>('/groups', 'POST', {
      name: `Federated Search ${suffix}`,
      path: `sim-federated-${suffix}`,
      visibility: 'private',
    })
    groupId = group.id
    const project = await api<{ id: number; path_with_namespace: string }>('/projects', 'POST', {
      name: 'Federated Search',
      path: 'search-fixture',
      namespace_id: group.id,
      visibility: 'private',
      default_branch: 'main',
      initialize_with_readme: false,
    })
    projectId = project.id
    projectPath = project.path_with_namespace
    for (const [name, role] of [
      ['reporter', 20],
      ['guest', 10],
      ['outsider', 0],
    ] as const) {
      const simId = name === 'reporter' ? ids.aliceId : name === 'guest' ? ids.bobId : generateId()
      if (name === 'outsider') {
        simUserIds.push(simId)
        await db.insert(user).values({
          id: simId,
          name: 'Federated outsider fixture',
          email: `${simId}@fixture.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }
      await db.insert(member).values({
        id: generateId(),
        organizationId: ids.organizationId,
        userId: simId,
        role: name === 'reporter' ? 'owner' : 'member',
        createdAt: new Date(),
      })
      const person = await api<{ id: number; email: string }>('/users', 'POST', {
        email: `${simId}@fixture.test`,
        username: `federated-${name}-${suffix}`,
        name: `Federated ${name} fixture`,
        password: `${generateId()}Aa1!`,
        skip_confirmation: true,
      })
      providerUserIds.push(person.id)
      const token = await api<{ token: string }>(
        `/users/${person.id}/personal_access_tokens`,
        'POST',
        {
          name: 'Disposable federated Search fixture',
          scopes: ['read_api'],
          expires_at: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        }
      )
      people[name] = { ...person, simId, token: token.token }
      if (role)
        await api(`/groups/${groupId}/members`, 'POST', { user_id: person.id, access_level: role })
    }
    await waitForProject(people.reporter!, 200)
    await waitForProject(people.guest!, 200)
    await api(`/projects/${projectId}/repository/files/fixture.md`, 'POST', {
      branch: 'main',
      content: `${QUERY} repository content.`,
      commit_message: 'Create disposable federated fixture',
    })
    await api(`/projects/${projectId}/wikis`, 'POST', {
      title: `${QUERY} wiki`,
      content: `${QUERY} wiki content.`,
      format: 'markdown',
    })
    issueIid = (
      await api<{ iid: number }>(`/projects/${projectId}/issues`, 'POST', {
        title: `${QUERY} normal issue`,
        description: `${QUERY} normal issue body.`,
      })
    ).iid
    confidentialIid = (
      await api<{ iid: number }>(`/projects/${projectId}/issues`, 'POST', {
        title: `${QUERY} confidential issue`,
        description: `${QUERY} confidential issue body.`,
        confidential: true,
      })
    ).iid
    await api(`/projects/${projectId}/repository/branches`, 'POST', {
      branch: 'fixture-change',
      ref: 'main',
    })
    await api(`/projects/${projectId}/repository/files/fixture.md`, 'PUT', {
      branch: 'fixture-change',
      content: `${QUERY} proposed content.`,
      commit_message: 'Update disposable federated fixture',
    })
    await api(`/projects/${projectId}/merge_requests`, 'POST', {
      source_branch: 'fixture-change',
      target_branch: 'main',
      title: `${QUERY} merge request`,
      description: `${QUERY} proposed content.`,
    })
    await db.insert(organizationSearchIntegration).values({
      organizationId: ids.organizationId,
      connectorType: 'gitlab',
      approved: true,
    })
    const created = await createKnowledgeConnector.execute({
      principal: principal(people.reporter!),
      input: {
        knowledgeBaseId: ids.knowledgeBaseId,
        assertedOrganizationId: ids.organizationId,
        connectorType: 'gitlab',
        accessMode: 'admin',
        apiKey: adminToken,
        sourceConfig: { host: new URL(base).host, project: projectPath, contentTypes: 'all' },
        permissionConfig: { provider: 'gitlab', mode: 'administrator' },
        syncIntervalMinutes: 60,
      },
    })
    connectorId = created.connector.id
    sourceRevision = created.connector.permissionConfig!.revision
  }, 300_000)

  afterAll(async () => {
    const cleanup = await Promise.allSettled([
      (async () => {
        if (groupId) await api(`/groups/${groupId}`, 'DELETE')
        for (const id of providerUserIds) await api(`/users/${id}?hard_delete=true`, 'DELETE')
      })(),
      (async () => {
        if (!ids) return
        await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
        await db.delete(organization).where(eq(organization.id, ids.organizationId))
        await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId, ...simUserIds]))
      })(),
    ])
    await db.$client.end()
    for (const result of cleanup) if (result.status === 'rejected') throw result.reason
  }, 120_000)

  it.each(['issues', 'code', 'wiki', 'merge_requests'] as const)(
    'searches and reads %s from the configured HTTPS instance with current permissions',
    async (kind) => {
      const result = await search(people.reporter!, kind)
      expect(result.live?.backend).toBe('live')
      expect(result.live?.accounts).toHaveLength(1)
      expect(result.live?.accounts[0]?.status).toBe('ok')
      expect(result.results.length).toBeGreaterThan(0)
      for (const row of result.results) {
        expect(row.knowledgeBaseId).toBe('')
        expect(decodeLiveReference(row.documentId)).toMatchObject({
          account: `gitlab-source:${connectorId}`,
          provider: 'gitlab',
          kind,
        })
        const document = await read(people.reporter!, row.documentId)
        expect(document.chunks.map((chunk) => chunk.content).join('\n')).toContain(QUERY)
        if (document.sourceUrl) expect(new URL(document.sourceUrl).origin).toBe(base)
      }
      expect((await search(people.outsider!, kind)).results).toEqual([])
    },
    120_000
  )

  it('keeps references reader-bound and rechecks confidentiality before reads', async () => {
    const reporter = await search(people.reporter!, 'code')
    const file = reporter.results[0]!
    await expect(read(people.guest!, file.documentId)).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      read(people.guest!, documentForReader(file.documentId, people.guest!))
    ).rejects.toBeDefined()
    const guest = await search(people.guest!, 'issues')
    const normal = guest.results.find(
      (row) => decodeLiveReference(row.documentId).id === String(issueIid)
    )!
    expect(normal).toBeDefined()
    expect(
      guest.results.some(
        (row) => decodeLiveReference(row.documentId).id === String(confidentialIid)
      )
    ).toBe(false)
    await api(`/projects/${projectId}/issues/${issueIid}`, 'PUT', { confidential: true })
    try {
      await expect(read(people.guest!, normal.documentId)).rejects.toBeDefined()
    } finally {
      await api(`/projects/${projectId}/issues/${issueIid}`, 'PUT', { confidential: false })
    }
  }, 120_000)

  it('observes provider membership revocation without a synchronization job', async () => {
    const before = await search(people.guest!, 'issues')
    expect(before.results.length).toBeGreaterThan(0)
    await api(`/groups/${groupId}/members/${people.guest!.id}`, 'DELETE')
    try {
      await waitForProject(people.guest!, 404)
      expect((await search(people.guest!, 'issues')).results).toEqual([])
      await expect(read(people.guest!, before.results[0]!.documentId)).rejects.toBeDefined()
    } finally {
      await api(`/groups/${groupId}/members`, 'POST', {
        user_id: people.guest!.id,
        access_level: 10,
      })
      await waitForProject(people.guest!, 200)
    }
  }, 180_000)

  it('switches to a non-admin token and CSV grants immediately, then observes CSV revocation', async () => {
    const permissions = (person: FixturePerson) => ({
      filename: 'project-permissions.csv',
      content: `project_path,user_id\n${projectPath},${person.id}\n`,
    })
    const switched = await updateKnowledgeConnector.execute({
      principal: principal(people.reporter!),
      input: {
        connectorId,
        assertedOrganizationId: ids.organizationId,
        updates: {
          apiKey: people.reporter!.token,
          permissionConfig: {
            provider: 'gitlab',
            mode: 'csv',
            expectedRevision: sourceRevision,
            userMapping: {
              filename: 'user-mapping.csv',
              content: `user_id,email\n${people.reporter!.id},${people.reporter!.email}\n${people.guest!.id},${people.guest!.email}\n`,
            },
            projectPermissions: permissions(people.guest!),
          },
        },
      },
    })
    sourceRevision = switched.connector.permissionConfig!.revision
    const [stored] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, connectorId))
    expect(stored?.accessRewritePending).toBe(true)
    const allowed = await search(people.guest!, 'issues')
    expect(allowed.results.map((row) => decodeLiveReference(row.documentId).id)).toEqual([
      String(issueIid),
    ])
    await expect(read(people.guest!, allowed.results[0]!.documentId)).resolves.toBeDefined()
    expect((await search(people.reporter!, 'issues')).results).toEqual([])
    await updateKnowledgeConnector.execute({
      principal: principal(people.reporter!),
      input: {
        connectorId,
        assertedOrganizationId: ids.organizationId,
        updates: {
          permissionConfig: {
            provider: 'gitlab',
            mode: 'csv',
            expectedRevision: sourceRevision,
            projectPermissions: permissions(people.reporter!),
          },
        },
      },
    })
    expect((await search(people.guest!, 'issues')).results).toEqual([])
    await expect(read(people.guest!, allowed.results[0]!.documentId)).rejects.toBeDefined()
    expect((await search(people.reporter!, 'issues')).results.length).toBeGreaterThan(0)
  }, 180_000)

  it('creates neither indexed content nor background ACL directories', async () => {
    expect(
      await db
        .select({ id: document.id })
        .from(document)
        .where(eq(document.connectorId, connectorId))
    ).toEqual([])
    expect(
      await db
        .select({ id: knowledgeConnectorSyncLog.id })
        .from(knowledgeConnectorSyncLog)
        .where(eq(knowledgeConnectorSyncLog.connectorId, connectorId))
    ).toEqual([])
    expect(await refreshConnectorDirectory(connectorId, 'federated-gitlab-fixture')).toBe('skipped')
    expect(
      await db
        .select({ id: knowledgeExternalGroup.id })
        .from(knowledgeExternalGroup)
        .where(
          and(
            eq(knowledgeExternalGroup.organizationId, ids.organizationId),
            eq(knowledgeExternalGroup.providerId, 'gitlab')
          )
        )
    ).toEqual([])
  })
})
