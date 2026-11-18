/** Real authorization, PostgreSQL, encryption, revision locks and HTTP provider responses. */

import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  knowledgeBase,
  knowledgeConnector,
  member,
  organization,
  organizationSearchIntegration,
  user,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const transport = vi.hoisted(() => ({ origin: '', paths: [] as string[] }))
vi.mock('@/lib/core/security/input-validation.server', async (original) => {
  const module = await original<typeof import('@/lib/core/security/input-validation.server')>()
  return {
    ...module,
    secureFetchWithValidation: async (url: string, options: RequestInit) => {
      const target = new URL(url)
      if (target.hostname !== 'gitlab.fixture.test')
        throw new Error('Unexpected fixture destination')
      transport.paths.push(target.pathname)
      return fetch(`${transport.origin}${target.pathname}${target.search}`, options)
    },
  }
})

import { seedKnowledgeAclFixture } from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { updateKnowledgeConnectorAccess } from '@/lib/knowledge/application/connector-access'
import { createKnowledgeConnector } from '@/lib/knowledge/application/connectors'
import {
  readSearchSourcePermissions,
  replaceSearchSourcePermissions,
} from '@/lib/knowledge/application/source-permissions'
import {
  loadConnectorPermissionSnapshot,
  readConnectorPermissionGrants,
} from '@/lib/knowledge/connectors/permission-store'
import { readLiveDocument, searchLiveKnowledge } from '@/lib/sim-search/live/application'
import { decodeLiveReference } from '@/lib/sim-search/live/reference'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

describe('GitLab group Search permission boundary', () => {
  let ids: Awaited<ReturnType<typeof seedKnowledgeAclFixture>>
  let sourceId: string
  let legacyId: string
  let moved = false
  let failedDiscovery = false
  let added = false
  let aliceLegacyResult: { documentId: string } | undefined
  let confidential = false
  let providerState = 'healthy'
  let largeProjectCount = 50_000
  let nativeGroup = false
  const checks: string[] = []
  const token = 'disposable-group-test-token'
  const principal = (userId: string): Principal => ({
    kind: 'personal_api_key',
    userId,
    keyId: 'group-test',
    access: 'write',
  })
  const config = {
    host: 'gitlab.fixture.test',
    scope: 'group',
    group: 'team',
    contentTypes: 'issues',
  }
  const permissions = (revoke = false, namespace = 'team') => ({
    provider: 'gitlab' as const,
    userMapping: {
      filename: 'users.csv',
      content: `user_id,email\n1,${ids.aliceId}@fixture.test\n2,${ids.bobId}@fixture.test`,
    },
    projectPermissions: {
      filename: 'permissions.csv',
      content: `project_path,user_id\n${namespace}/a,${revoke ? 2 : 1}\n${namespace}/b,2${added ? `\n${namespace}/c,1` : ''}`,
    },
  })
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture')
    const path = decodeURIComponent(url.pathname)
    const reply = (status: number, body: unknown, headers = {}) => {
      response.writeHead(status, { 'content-type': 'application/json', ...headers })
      response.end(JSON.stringify(body))
    }
    if (
      request.headers['private-token'] !== token &&
      request.headers.authorization !== `Bearer ${token}`
    )
      return reply(401, {})
    if (providerState === 'revoked') return reply(401, {})
    const namespace = providerState === 'renamed' ? 'renamed-team' : 'team'
    if (path === '/api/v4/user') return reply(200, { id: 50, state: 'active', locked: false })
    if (path === '/api/v4/groups/8') return reply(200, { id: 8, full_path: 'large' })
    if (path === '/api/v4/groups/8/projects') {
      const page = Number(url.searchParams.get('page') ?? 1)
      const offset = (page - 1) * 100
      return reply(
        200,
        Array.from(
          { length: Math.max(0, Math.min(100, largeProjectCount - offset)) },
          (_, index) => ({
            id: 100_000 + offset + index,
            path_with_namespace: `large/project-${String(offset + index).padStart(5, '0')}-permission-fixture`,
          })
        )
      )
    }
    if (path === '/api/v4/projects/149999')
      return reply(200, {
        id: 149999,
        path_with_namespace: 'large/project-49999-permission-fixture',
        web_url: 'https://gitlab.fixture.test/large/project-49999-permission-fixture',
      })
    if (
      path === '/api/v4/groups/8/search' ||
      path === '/api/v4/projects/149999/search' ||
      path === '/api/v4/projects/149999/issues/1'
    ) {
      const issue = {
        project_id: 149999,
        iid: 1,
        title: 'Atlas last project',
        description: 'Atlas permitted content',
        confidential: false,
        state: 'opened',
        labels: [],
        web_url: 'https://gitlab.fixture.test/large/project-49999-permission-fixture/-/issues/1',
      }
      return reply(200, path.endsWith('/search') ? [issue] : issue)
    }
    if (path === '/api/v4/projects/149999/issues/1/notes') return reply(200, [])
    if (path === '/api/v4/groups/team' && providerState === 'renamed')
      return reply(301, {}, { location: '/api/v4/groups/7' })
    if (path === '/api/v4/groups/team' || path === '/api/v4/groups/7')
      return reply(200, { id: 7, full_path: namespace })
    if (path === '/api/v4/groups/7/search') {
      if (providerState === 'search-token-expired') return reply(401, {})
      if (providerState === 'search-rate-limited') return reply(429, {}, { 'retry-after': '60' })
      if (!nativeGroup || url.searchParams.get('scope') !== 'issues') return reply(400, {})
      if (
        url.searchParams.get('exclude_forks') !== 'false' ||
        url.searchParams.get('include_archived') !== 'true'
      )
        return reply(200, [])
      const rows = [12, 11, 13, 99, 11].map((id, index) => ({
        project_id: id,
        iid: index === 4 ? 2 : 1,
        title: `Atlas ${id}`,
        description: 'Atlas content',
        confidential: index === 4,
        state: 'opened',
        labels: [],
        web_url: `https://gitlab.fixture.test/${namespace}/${id === 11 ? 'a' : id === 12 ? 'b' : 'c'}/-/issues/1`,
      }))
      const page = Number(url.searchParams.get('page') ?? 1)
      const size = Number(url.searchParams.get('per_page') ?? 20)
      if (page === 5000) return reply(200, [rows[1], rows[2]])
      return reply(200, rows.slice((page - 1) * size, page * size))
    }
    if (path === '/api/v4/groups/7/projects') {
      if (url.searchParams.get('with_shared') !== 'false') return reply(400, {})
      const projects = [
        { id: 11, path_with_namespace: `${namespace}/a` },
        { id: 12, path_with_namespace: `${namespace}/b` },
      ]
      if (added) projects.push({ id: 13, path_with_namespace: `${namespace}/c` })
      const page = url.searchParams.get('page') ?? '1'
      if (page === '1')
        return reply(200, projects.slice(0, 1), {
          'x-total': String(projects.length),
          'x-next-page': '2',
        })
      if (failedDiscovery) return reply(403, {})
      return reply(200, projects.slice(1), {
        'x-total': String(projects.length),
        'x-next-page': '',
      })
    }
    const match = path.match(/^\/api\/v4\/projects\/(11|12|13)(.*)$/)
    if (!match) return reply(404, {})
    const id = Number(match[1])
    const projectPath =
      id === 11
        ? moved
          ? 'outside/a'
          : `${namespace}/a`
        : id === 12
          ? `${namespace}/b`
          : `${namespace}/c`
    const issue = (iid: number) => ({
      project_id: id,
      iid,
      title: `Atlas ${id} ${iid}`,
      description: `Atlas content ${id} ${iid}`,
      confidential,
      state: 'opened',
      labels: [],
      web_url: `https://gitlab.fixture.test/${projectPath}/-/issues/${iid}`,
    })
    if (!match[2])
      return reply(200, {
        id,
        path_with_namespace: projectPath,
        web_url: `https://gitlab.fixture.test/${projectPath}`,
      })
    if (match[2] === '/search') {
      if (providerState === 'search-token-expired') return reply(401, {})
      if (providerState === 'search-rate-limited') return reply(429, {}, { 'retry-after': '60' })
      if (url.searchParams.get('scope') === 'blobs' && id === 11 && nativeGroup)
        return reply(200, [
          {
            project_id: 11,
            filename: 'atlas.md',
            path: 'atlas.md',
            ref: 'main',
            data: 'Atlas code content',
          },
        ])
      if (url.searchParams.get('scope') !== 'issues') return reply(200, [])
      const page = Number(url.searchParams.get('page') ?? 1)
      const size = Number(url.searchParams.get('per_page') ?? 20)
      return reply(200, [issue(1), issue(2), issue(3)].slice((page - 1) * size, page * size))
    }
    const issueMatch = match[2]?.match(/^\/issues\/(\d+)$/)
    if (issueMatch) return reply(200, issue(Number(issueMatch[1])))
    if (match[2] === '/repository/files/atlas.md')
      return reply(200, {
        file_name: 'atlas.md',
        content: Buffer.from('Atlas code content').toString('base64'),
      })
    if (match[2]?.endsWith('/notes')) return reply(200, [])
    return reply(404, {})
  })

  const search = (
    userId: string,
    project?: string,
    cursor?: string,
    topK = 20,
    accountId = sourceId,
    kind: 'issues' | 'all' = 'issues'
  ) =>
    searchLiveKnowledge.execute({
      principal: principal(userId),
      input: {
        organizationId: ids.organizationId,
        query: 'Atlas',
        topK,
        filters: { source: 'gitlab' },
        nativeQueries: [
          {
            provider: 'gitlab',
            query: 'Atlas',
            ...(kind === 'issues' ? { kind: 'issues' as const } : {}),
            accountId: `gitlab-source:${accountId}`,
            ...(project ? { project } : {}),
            ...(cursor ? { cursor } : {}),
          },
        ],
        resultSecretRegistry: new ResolvedSecretTraceRegistry(),
      },
    })
  const read = (userId: string, documentId: string) =>
    readLiveDocument.execute({
      principal: principal(userId),
      input: {
        organizationId: ids.organizationId,
        documentId,
        limit: 3,
        resultSecretRegistry: new ResolvedSecretTraceRegistry(),
      },
    })
  const replace = (revision: number, revoke = false) =>
    replaceSearchSourcePermissions.execute({
      principal: principal(ids.aliceId),
      input: {
        organizationId: ids.organizationId,
        sourceId,
        expectedRevision: revision,
        permissions: permissions(revoke),
      },
    })

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    transport.origin = `http://127.0.0.1:${address.port}`
    ids = await seedKnowledgeAclFixture()
    await db.delete(knowledgeConnector).where(eq(knowledgeConnector.id, ids.connectorId))
    await db
      .update(knowledgeBase)
      .set({ workspaceId: null, organizationId: ids.organizationId, isSearchIndex: true })
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db.insert(member).values(
      [ids.aliceId, ids.bobId].map((id) => ({
        id: generateId(),
        organizationId: ids.organizationId,
        userId: id,
        role: id === ids.aliceId ? 'owner' : 'member',
        createdAt: new Date(),
      }))
    )
    await db
      .insert(organizationSearchIntegration)
      .values({ organizationId: ids.organizationId, connectorType: 'gitlab', approved: true })
    const create = (sourceConfig: Record<string, unknown>) =>
      createKnowledgeConnector.execute({
        principal: principal(ids.aliceId),
        input: {
          knowledgeBaseId: ids.knowledgeBaseId,
          assertedOrganizationId: ids.organizationId,
          connectorType: 'gitlab',
          accessMode: 'admin',
          apiKey: token,
          sourceConfig,
          permissionConfig: { ...permissions(), mode: 'csv' },
          syncIntervalMinutes: 60,
        },
      })
    legacyId = (await create({ host: config.host, project: '11', contentTypes: 'issues' }))
      .connector.id
    sourceId = (await create(config)).connector.id
  }, 60000)

  afterAll(async () => {
    if (process.env.GITLAB_GROUP_REPORT_PATH)
      await writeFile(
        process.env.GITLAB_GROUP_REPORT_PATH,
        JSON.stringify(
          {
            boundary:
              'Application use cases, real PostgreSQL and HTTP GitLab API fixture; TLS/SSRF transport substituted',
            checks,
          },
          null,
          2
        )
      )
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (ids) {
      await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspaceId))
      await db.delete(organization).where(eq(organization.id, ids.organizationId))
      await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    }
    await db.$client.end()
  })

  it('keeps connection settings usable without scheduling ingestion or bypassing permission scope', async () => {
    const update = (sourceConfig?: Record<string, unknown>) =>
      updateKnowledgeConnectorAccess.execute({
        principal: { kind: 'session', userId: ids.aliceId, sessionId: 'fixture-session' },
        input: {
          knowledgeBaseId: ids.knowledgeBaseId,
          connectorId: sourceId,
          assertedOrganizationId: ids.organizationId,
          accessMode: 'admin',
          ...(sourceConfig ? { sourceConfig } : {}),
        },
      })
    expect((await update()).changed).toBe(false)
    await update({ ...config, group: '%74eam', issueState: 'opened' })
    const [saved] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, sourceId))
    expect(saved?.nextSyncAt).toBeNull()
    expect(saved?.nextMemberSyncAt).toBeNull()
    for (const state of ['revoked', 'renamed']) {
      providerState = state
      try {
        await expect(update()).rejects.toMatchObject({ code: 'validation' })
      } finally {
        providerState = 'healthy'
      }
    }

    for (const changedScope of [
      { ...config, group: 'another-group' },
      { ...config, includeSubgroups: 'true' },
      { host: config.host, scope: 'project', project: '11' },
    ]) {
      await expect(update(changedScope)).rejects.toMatchObject({ code: 'validation' })
    }
    const [unchanged] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, sourceId))
    expect(unchanged).toEqual(saved)
    expect(
      await readSearchSourcePermissions.execute({
        principal: principal(ids.aliceId),
        input: { organizationId: ids.organizationId, sourceId },
      })
    ).toEqual({ revision: 1 })
    expect((await search(ids.aliceId)).results.length).toBeGreaterThan(0)
    checks.push('Connection settings preserve live-only scheduling and canonical permission scope')
  })

  it('rejects dot-segment group identifiers before sending the token', async () => {
    for (const group of ['.', '..', '%2e', '%2e%2e', '.%2e', '%2e.']) {
      const requests = transport.paths.length
      await expect(
        createKnowledgeConnector.execute({
          principal: principal(ids.aliceId),
          input: {
            knowledgeBaseId: ids.knowledgeBaseId,
            assertedOrganizationId: ids.organizationId,
            connectorType: 'gitlab',
            accessMode: 'admin',
            apiKey: token,
            sourceConfig: { ...config, group },
            permissionConfig: { ...permissions(), mode: 'csv' },
            syncIntervalMinutes: 60,
          },
        })
      ).rejects.toMatchObject({ code: 'validation' })
      expect(transport.paths).toHaveLength(requests)
    }
    checks.push('Invalid group IDs fail before provider requests')
  })

  it('separates readers by project and rejects cross-project reads', async () => {
    const alice = await search(ids.aliceId)
    const bob = await search(ids.bobId)
    expect(alice.results.length).toBeGreaterThan(0)
    expect(bob.results.length).toBeGreaterThan(0)
    expect(
      new Set(alice.results.map((row) => decodeLiveReference(row.documentId).container))
    ).toEqual(new Set(['11']))
    expect(
      new Set(bob.results.map((row) => decodeLiveReference(row.documentId).container))
    ).toEqual(new Set(['12']))
    const first = alice.results[0]
    if (!first) throw new Error('Missing allowed fixture result')
    expect((await read(ids.aliceId, first.documentId)).chunks.length).toBeGreaterThan(0)
    await expect(read(ids.bobId, first.documentId)).rejects.toMatchObject({ code: 'not_found' })
    expect((await search(ids.aliceId, '12')).results).toEqual([])
    expect((await search(ids.aliceId, '99')).results).toEqual([])
    confidential = true
    expect((await search(ids.aliceId)).results).toEqual([])
    await expect(read(ids.aliceId, first.documentId)).rejects.toMatchObject({ code: 'not_found' })
    confidential = false
    moved = true
    expect((await search(ids.aliceId)).results).toEqual([])
    moved = false
    for (const [state, status] of [
      ['search-token-expired', 'reconnect'],
      ['search-rate-limited', 'rate_limited'],
    ]) {
      providerState = state
      const requests = transport.paths.length
      try {
        const failed = await search(ids.aliceId)
        expect(failed.results).toEqual([])
        expect(failed.live?.accounts[0]?.status).toBe(status)
        expect(
          transport.paths.slice(requests).filter((path) => path.endsWith('/search'))
        ).toHaveLength(1)
      } finally {
        providerState = 'healthy'
      }
    }
    checks.push('Per-project identity, reference, confidentiality and moved-project isolation')
  })

  it('atomically discovers new projects and enforces revocation without touching the existing source', async () => {
    const initial = await search(ids.aliceId)
    const first = initial.results[0]
    if (!first) throw new Error('Missing allowed fixture result')
    const [legacy] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, legacyId))
    added = true
    expect(await replace(1, true)).toEqual({ revision: 2 })
    expect(
      await readConnectorPermissionGrants(
        sourceId,
        1,
        ['project:11'],
        `u:${ids.bobId}@fixture.test`
      )
    ).toEqual(new Set())
    expect(
      await readConnectorPermissionGrants(
        sourceId,
        2,
        ['project:11'],
        `u:${ids.bobId}@fixture.test`
      )
    ).toEqual(new Set(['project:11']))
    expect((await search(ids.aliceId, '13')).results.length).toBeGreaterThan(0)
    expect((await search(ids.aliceId, '11')).results).toEqual([])
    await expect(read(ids.aliceId, first.documentId)).rejects.toMatchObject({ code: 'not_found' })
    expect((await search(ids.bobId, '11')).results.length).toBeGreaterThan(0)
    const [unchanged] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, legacyId))
    expect(unchanged).toEqual(legacy)
    const legacyRevision = await readSearchSourcePermissions.execute({
      principal: principal(ids.aliceId),
      input: { organizationId: ids.organizationId, sourceId: legacyId },
    })
    expect(legacyRevision).toEqual({ revision: 1 })
    aliceLegacyResult = (await search(ids.aliceId, '11', undefined, 20, legacyId)).results[0]
    expect(aliceLegacyResult).toBeDefined()
    await replaceSearchSourcePermissions.execute({
      principal: principal(ids.aliceId),
      input: {
        organizationId: ids.organizationId,
        sourceId: legacyId,
        expectedRevision: 1,
        permissions: permissions(true),
      },
    })
    expect((await search(ids.aliceId, '11', undefined, 20, legacyId)).results).toEqual([])
    expect((await search(ids.bobId, '11', undefined, 20, legacyId)).results.length).toBeGreaterThan(
      0
    )
    expect(
      await readSearchSourcePermissions.execute({
        principal: principal(ids.aliceId),
        input: {
          organizationId: ids.organizationId,
          sourceId,
        },
      })
    ).toEqual({ revision: 2 })
    checks.push('Atomic group refresh, revocation and existing source preservation')
  })

  it('leaves a source out of the searches of a reader its uploaded permissions no longer grant', async () => {
    const accounts = async (userId: string) =>
      (
        await searchLiveKnowledge.execute({
          principal: principal(userId),
          input: {
            organizationId: ids.organizationId,
            query: 'Atlas',
            topK: 20,
            filters: { source: 'gitlab' },
            resultSecretRegistry: new ResolvedSecretTraceRegistry(),
          },
        })
      ).live?.accounts ?? []
    const alice = await accounts(ids.aliceId)
    expect(alice.map((account) => account.accountId)).toEqual([`gitlab-source:${sourceId}`])
    expect(alice.every((account) => account.status === 'ok')).toBe(true)
    expect(new Set((await accounts(ids.bobId)).map((account) => account.accountId))).toEqual(
      new Set([`gitlab-source:${sourceId}`, `gitlab-source:${legacyId}`])
    )
    if (!aliceLegacyResult) throw new Error('Missing result found before revocation')
    await expect(read(ids.aliceId, aliceLegacyResult.documentId)).rejects.toThrow(
      'This GitLab source is not available to your account.'
    )
    checks.push('Sources granting the reader nothing are left out of their searches')
  })

  it('preserves all grants on discovery failure and admits only one concurrent revision', async () => {
    failedDiscovery = true
    await expect(replace(2)).rejects.toMatchObject({ code: 'validation' })
    failedDiscovery = false
    expect((await search(ids.bobId, '11')).results.length).toBeGreaterThan(0)
    const results = await Promise.allSettled([replace(2), replace(2)])
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((row) => row.status === 'rejected')).toHaveLength(1)
    expect(results.find((row) => row.status === 'rejected')).toMatchObject({
      reason: { code: 'conflict' },
    })
    expect(results.find((row) => row.status === 'fulfilled')).toMatchObject({
      value: { revision: 3 },
    })
    expect(
      await readSearchSourcePermissions.execute({
        principal: principal(ids.aliceId),
        input: {
          organizationId: ids.organizationId,
          sourceId,
        },
      })
    ).toEqual({ revision: 3 })
    checks.push('Failure atomicity and concurrent revision protection')
  })

  it('continues through all permitted project pages without gaps and rejects stale cursors', async () => {
    const documents: string[] = []
    let cursor: string | undefined
    let firstCursor: string | undefined
    for (let page = 0; page < 10; page += 1) {
      const result = await search(ids.aliceId, undefined, cursor, 2)
      for (const row of result.results) {
        const ref = decodeLiveReference(row.documentId)
        documents.push(`${ref.container}:${ref.id}`)
      }
      cursor = result.live?.accounts[0]?.nextCursor
      firstCursor ??= cursor
      if (!cursor) break
    }
    expect(documents.sort()).toEqual(['11:1', '11:2', '11:3', '13:1', '13:2', '13:3'])
    expect(firstCursor).toBeTruthy()
    await replace(3)
    const stale = await search(ids.aliceId, undefined, firstCursor, 2)
    expect(stale.results).toEqual([])
    expect(stale.live?.accounts[0]?.status).not.toBe('ok')
    checks.push('Complete bounded pagination and stale continuation rejection')
  })

  it('rejects group scope for ordinary knowledge base ingestion', async () => {
    const knowledgeBaseId = generateId()
    await db.insert(knowledgeBase).values({
      id: knowledgeBaseId,
      userId: ids.aliceId,
      workspaceId: ids.workspaceId,
      name: 'Ordinary KB fixture',
    })
    await expect(
      createKnowledgeConnector.execute({
        principal: principal(ids.aliceId),
        input: {
          knowledgeBaseId,
          assertedWorkspaceId: ids.workspaceId,
          connectorType: 'gitlab',
          accessMode: 'admin',
          apiKey: token,
          sourceConfig: config,
          permissionConfig: { ...permissions(), mode: 'csv' },
          syncIntervalMinutes: 60,
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    checks.push('Search-only group scope and unchanged knowledge base ingestion')
  })

  it('keeps group updates restricted to organization admins', async () => {
    await expect(
      replaceSearchSourcePermissions.execute({
        principal: principal(ids.bobId),
        input: {
          organizationId: ids.organizationId,
          sourceId,
          expectedRevision: 4,
          permissions: permissions(),
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    checks.push('Organization administration boundary')
  })

  it.each(['team', '7'])(
    'refreshes renamed groups only when saved scope %s still matches',
    async (group) => {
      const { connector } = await createKnowledgeConnector.execute({
        principal: principal(ids.aliceId),
        input: {
          knowledgeBaseId: ids.knowledgeBaseId,
          assertedOrganizationId: ids.organizationId,
          connectorType: 'gitlab',
          accessMode: 'admin',
          apiKey: token,
          sourceConfig: { ...config, group },
          permissionConfig: { ...permissions(), mode: 'csv' },
          syncIntervalMinutes: 60,
        },
      })
      const before = await loadConnectorPermissionSnapshot(connector.id)
      providerState = 'renamed'
      try {
        const refresh = replaceSearchSourcePermissions.execute({
          principal: principal(ids.aliceId),
          input: {
            organizationId: ids.organizationId,
            sourceId: connector.id,
            expectedRevision: 1,
            permissions: permissions(false, 'renamed-team'),
          },
        })
        if (group === 'team') {
          await expect(refresh).rejects.toMatchObject({ code: 'validation' })
          expect(await loadConnectorPermissionSnapshot(connector.id)).toEqual(before)
          providerState = 'healthy'
        } else {
          expect(await refresh).toEqual({ revision: 2 })
        }
        const results = (await search(ids.aliceId, '11', undefined, 20, connector.id)).results
        expect(results.length).toBeGreaterThan(0)
        const first = results[0]
        if (!first) throw new Error('Missing allowed fixture result')
        expect((await read(ids.aliceId, first.documentId)).chunks.length).toBeGreaterThan(0)
        expect((await search(ids.bobId, '11', undefined, 20, connector.id)).results).toEqual([])
        checks.push(`Renamed group refresh preserves permissions for configured scope ${group}`)
      } finally {
        providerState = 'healthy'
      }
    }
  )

  it('connects a complete large group and preserves its grants when the next discovery exceeds the bound', async () => {
    const grantRows = Array.from({ length: 50_000 }, (_, index) => {
      const path = `large/project-${String(index).padStart(5, '0')}-permission-fixture`
      return `${path},1\n${path},3\n${path},4`
    }).join('\n')
    const uploads = {
      provider: 'gitlab' as const,
      userMapping: {
        filename: 'users.csv',
        content: `user_id,email\n1,${ids.aliceId}@fixture.test\n2,${ids.bobId}@fixture.test\n3,third@fixture.test\n4,fourth@fixture.test`,
      },
      projectPermissions: {
        filename: 'permissions.csv',
        content: `project_path,user_id\n${grantRows}`,
      },
    }
    const started = performance.now()
    const { connector } = await createKnowledgeConnector.execute({
      principal: principal(ids.aliceId),
      input: {
        knowledgeBaseId: ids.knowledgeBaseId,
        assertedOrganizationId: ids.organizationId,
        connectorType: 'gitlab',
        accessMode: 'admin',
        apiKey: token,
        sourceConfig: { ...config, group: '8' },
        permissionConfig: { ...uploads, mode: 'csv' },
        syncIntervalMinutes: 60,
      },
    })
    const snapshot = await loadConnectorPermissionSnapshot(connector.id)
    expect(snapshot?.metadata).toMatchObject({
      projects: expect.any(Array),
      projectPermissions: { rowCount: 150_000 },
    })
    const page = await search(ids.aliceId, '149999', undefined, 20, connector.id)
    const first = page.results[0]
    if (!first) throw new Error('Missing last-project result')
    expect((await read(ids.aliceId, first.documentId)).chunks.length).toBeGreaterThan(0)
    await expect(read(ids.bobId, first.documentId)).rejects.toMatchObject({ code: 'not_found' })
    const beforeBroadSearch = transport.paths.length
    const broad = await search(ids.aliceId, undefined, undefined, 20, connector.id)
    expect(broad.results.map((row) => decodeLiveReference(row.documentId).container)).toEqual([
      '149999',
    ])
    expect(
      transport.paths
        .slice(beforeBroadSearch)
        .filter((path) => /^\/api\/v4\/projects\/\d+\/search$/.test(path))
    ).toEqual([])
    const legacy = await search(ids.aliceId, undefined, '1:20:49999:0:1', 20, connector.id)
    expect(legacy.results.map((row) => decodeLiveReference(row.documentId).container)).toEqual([
      '149999',
    ])
    largeProjectCount = 50_001
    try {
      await expect(
        replaceSearchSourcePermissions.execute({
          principal: principal(ids.aliceId),
          input: {
            organizationId: ids.organizationId,
            sourceId: connector.id,
            expectedRevision: 1,
            permissions: uploads,
          },
        })
      ).rejects.toMatchObject({ code: 'validation' })
      expect(await loadConnectorPermissionSnapshot(connector.id)).toEqual(snapshot)
      expect(
        (await search(ids.aliceId, '149999', undefined, 20, connector.id)).results.length
      ).toBeGreaterThan(0)
    } finally {
      largeProjectCount = 50_000
    }
    checks.push(
      `Complete large-group discovery, larger CSV replacement and failed-update rollback (${Math.round(performance.now() - started)} ms)`
    )
  })

  it('uses group search while preserving project grants, confidentiality and continuations', async () => {
    nativeGroup = true
    const requests = transport.paths.length
    try {
      const found: string[] = []
      let cursor: string | undefined
      for (let page = 0; page < 5; page += 1) {
        const result = await search(ids.aliceId, undefined, cursor, 2)
        found.push(
          ...result.results.map((row) => {
            const ref = decodeLiveReference(row.documentId)
            return `${ref.container}:${ref.id}`
          })
        )
        cursor = result.live?.accounts[0]?.nextCursor
        if (!cursor) break
      }
      expect(cursor).toBeUndefined()
      expect(found).toEqual(['11:1', '13:1'])
      const paths = transport.paths.slice(requests)
      expect(paths.filter((path) => path === '/api/v4/groups/7/search').length).toBeGreaterThan(0)
      expect(paths.filter((path) => /^\/api\/v4\/projects\/\d+\/search$/.test(path))).toEqual([])
      checks.push(
        'Native group search filters forbidden, confidential and unconfigured projects across pages'
      )
    } finally {
      nativeGroup = false
    }
  })

  it('continues supported group searches when code and wiki require project search', async () => {
    const { connector } = await createKnowledgeConnector.execute({
      principal: principal(ids.aliceId),
      input: {
        knowledgeBaseId: ids.knowledgeBaseId,
        assertedOrganizationId: ids.organizationId,
        connectorType: 'gitlab',
        accessMode: 'admin',
        apiKey: token,
        sourceConfig: { ...config, contentTypes: 'all' },
        permissionConfig: { ...permissions(), mode: 'csv' },
        syncIntervalMinutes: 60,
      },
    })
    nativeGroup = true
    const requests = transport.paths.length
    try {
      const kinds: string[] = []
      let cursor: string | undefined
      for (let page = 0; page < 12; page += 1) {
        const result = await search(ids.aliceId, undefined, cursor, 20, connector.id, 'all')
        kinds.push(...result.results.map((row) => decodeLiveReference(row.documentId).kind ?? ''))
        cursor = result.live?.accounts[0]?.nextCursor
        if (!cursor) break
      }
      expect(cursor).toBeUndefined()
      expect(kinds).toContain('code')
      expect(kinds).toContain('issues')
      expect(
        transport.paths.slice(requests).filter((path) => path === '/api/v4/groups/7/search').length
      ).toBeGreaterThan(0)
      checks.push('Unsupported group scopes do not starve supported scopes')
    } finally {
      nativeGroup = false
    }
  })

  it('reports the group search result window as partial instead of offering an empty next page', async () => {
    const snapshot = await loadConnectorPermissionSnapshot(sourceId)
    if (!snapshot) throw new Error('Missing group fixture')
    const cursor = `g1.${Buffer.from(
      JSON.stringify({
        revision: snapshot.revision,
        pageSize: 2,
        kinds: ['issues'],
        nextKind: 0,
        capped: false,
        positions: [{ mode: 'group', projectIndex: 0, page: 5000 }],
      })
    ).toString('base64url')}`
    nativeGroup = true
    try {
      const result = await search(ids.aliceId, undefined, cursor, 2)
      expect(result.results).toHaveLength(2)
      expect(result.live?.accounts[0]?.status).toBe('partial')
      expect(result.live?.accounts[0]?.nextCursor).toBeUndefined()
      checks.push('Search window returns authorized results with explicit partial coverage')
    } finally {
      nativeGroup = false
    }
  })
})
