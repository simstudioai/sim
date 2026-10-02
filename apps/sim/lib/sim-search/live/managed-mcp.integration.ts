import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { db } from '@sim/db'
import {
  credential,
  credentialGroupEnrollment,
  mcpServers,
  member,
  organization,
  organizationSearchIntegration,
  user,
} from '@sim/db/schema'
import { readTestRedisUrl } from '@sim/db/testing/test-infrastructure'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { env } from '@/lib/core/config/env'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import { createManagedMcpConnector } from '@/lib/credential-groups/managed-mcp-service'
import { createViewerCredentialGroupEnrollment } from '@/lib/credential-groups/self-enrollment'
import { ensureWorkspaceAccountsGroup } from '@/lib/credential-groups/service'
import { encryptManagedMcpTokens } from '@/lib/credentials/managed-mcp'
import * as pinnedFetch from '@/lib/mcp/pinned-fetch'
import { readLiveDocument, searchLiveKnowledge } from '@/lib/sim-search/live/application'
import { createManagedSearchMcpClient } from '@/lib/sim-search/live/managed-mcp'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const RESOURCE = 'https://mcp.lucid.app/mcp/readonly'
const DOCUMENT = '00000000-0000-4000-8000-000000000001'
const SECOND_DOCUMENT = '00000000-0000-4000-8000-000000000002'
const TITLE = 'Synthetic topology'
const actors = [0, 1].map(() => ({
  userId: generateId(),
  organizationId: generateId(),
  credentialId: `mcp-cg-${generateId()}`,
  token: generateId(),
  provider: 'lucid' as 'lucid' | 'notion',
}))
actors.push({
  userId: generateId(),
  organizationId: actors[0].organizationId,
  credentialId: `mcp-cg-${generateId()}`,
  token: generateId(),
  provider: 'lucid',
})
actors.push({
  userId: generateId(),
  organizationId: generateId(),
  credentialId: `mcp-cg-${generateId()}`,
  token: generateId(),
  provider: 'notion',
})
const NOTION_RESOURCE = 'https://mcp.notion.com/mcp'
const sessions = new Map<string, { transport: StreamableHTTPServerTransport; actor: number }>()
const serverIds = new Map<string, string>()
const protocols: Server[] = []
const openTransports = new Set<{ close(): Promise<void> }>()
const events: { method: string; actor: number; at: number }[] = []
const measurements: { name: string; durationMs: number; initializations: number }[] = []
let origin = ''
let setupDelay = 0
let onTool: ((name: string, args: Record<string, unknown>) => Promise<void>) | undefined
let failDiscovery = false
let onInitialize: (() => Promise<void>) | undefined
let onDiscovery: (() => Promise<void>) | undefined

function payload(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
}

const providerServer = createServer(async (request, response) => {
  try {
    const token = request.headers.authorization?.replace(/^Bearer /, '')
    const actor = actors.findIndex((candidate) => candidate.token === token)
    if (actor < 0) {
      response.writeHead(401).end()
      return
    }
    const id = request.headers['mcp-session-id']
    let session = typeof id === 'string' ? sessions.get(id) : undefined
    if (session && session.actor !== actor) {
      response.writeHead(403).end()
      return
    }
    if (!session) {
      if (id || request.method !== 'POST') {
        response.writeHead(404).end()
        return
      }
      events.push({ method: 'initialize', actor, at: performance.now() })
      await onInitialize?.()
      await sleep(setupDelay)
      const protocol = new Server(
        { name: 'synthetic-lucid', version: '1' },
        { capabilities: { tools: {} } }
      )
      protocol.setRequestHandler(ListToolsRequestSchema, async ({ params }) => {
        events.push({ method: 'tools/list', actor, at: performance.now() })
        await onDiscovery?.()
        if (failDiscovery && params?.cursor) throw new Error('Synthetic discovery failure')
        return {
          ...(failDiscovery ? { nextCursor: 'second-page' } : {}),
          tools: [
            'search',
            'fetch',
            'lucid_get_document_metadata',
            'lucid_list_folder_contents',
            'notion-get-tool-access',
            'notion-search',
            'notion-list-private-pages',
            'notion-list-shared-pages',
            'notion-fetch',
            'write_document',
          ].map((name) => ({
            name,
            inputSchema: {
              type: 'object' as const,
              properties: {
                query: { type: 'string' },
                cursor: { type: 'string' },
                limit: { type: 'number' },
                sort: { type: 'string' },
                product: { type: 'array', items: { type: 'string' } },
                last_modified_after: { type: 'string' },
              },
              additionalProperties: name !== 'search',
            },
          })),
        }
      })
      protocol.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
        events.push({ method: params.name, actor, at: performance.now() })
        await onTool?.(params.name, params.arguments ?? {})
        const documentId =
          params.arguments?.query === 'second topology' ||
          params.arguments?.document_id === SECOND_DOCUMENT ||
          params.arguments?.id === SECOND_DOCUMENT
            ? SECOND_DOCUMENT
            : DOCUMENT
        const documentTitle = documentId === SECOND_DOCUMENT ? 'Second topology' : TITLE
        const documentUrl = `https://lucid.app/lucidchart/${documentId}/edit`
        if (params.name === 'notion-get-tool-access')
          return payload({
            current_tool_access: {
              search: { status: 'available' },
              list_private_pages: { status: 'available' },
              list_shared_pages: { status: 'available' },
            },
          })
        if (params.name === 'notion-search' || params.name.startsWith('notion-list-'))
          return payload({
            results: [
              {
                type: 'page',
                title: TITLE,
                url: `https://www.notion.so/${params.arguments?.cursor ? SECOND_DOCUMENT : DOCUMENT}`,
              },
            ],
            ...(params.arguments?.cursor ? {} : { nextCursor: 'offset:1' }),
          })
        if (params.name === 'notion-fetch')
          return payload({
            id: params.arguments?.id,
            text: 'Private page evidence',
            page_last_edited_at: '2026-09-01T12:00:00Z',
          })
        if (params.name === 'lucid_list_folder_contents' && params.arguments?.folder_id === 42)
          return payload({
            items: [
              {
                id: SECOND_DOCUMENT,
                type: 'document',
                product: 'lucidchart',
                name: 'Second topology',
                isShortcut: false,
              },
            ],
          })
        if (params.name === 'lucid_list_folder_contents')
          return payload(
            params.arguments?.page_token
              ? {
                  items: [
                    {
                      id: DOCUMENT,
                      type: 'document',
                      product: 'lucidchart',
                      name: TITLE,
                      isShortcut: false,
                    },
                  ],
                }
              : {
                  items: [{ id: 42, type: 'folder', name: 'Architecture', isShortcut: false }],
                  nextPageToken: 'page-two',
                }
          )
        if (params.name === 'search')
          return payload({ results: [{ id: documentId, title: documentTitle, url: documentUrl }] })
        if (params.name === 'lucid_get_document_metadata')
          return payload({
            documentId,
            title: documentTitle,
            product: 'lucidchart',
            viewUrl: documentUrl,
            version: 7,
            pageCount: 1,
            lastModified: '2026-09-01T12:00:00Z',
          })
        const manifest = {
          document_id: documentId,
          title: documentTitle,
          edit_url: documentUrl,
          metadata: { page_count: 1, page_region_counts: [1] },
        }
        if (params.arguments?.metadata_only) return payload(manifest)
        return payload({
          ...manifest,
          metadata: { ...manifest.metadata, page_index: 1 },
          page_id: 'page-0',
          page_index: 1,
          text: JSON.stringify({
            pages: [
              {
                pageId: 'page-0',
                pageTitle: 'Topology',
                pageIndex: 0,
                totalChunks: 1,
                requestedChunks: [
                  {
                    chunkIndex: 0,
                    data: {
                      nodes: [{ label: `Private diagram ${actor}: ${documentTitle}` }],
                      edges: [],
                    },
                  },
                ],
              },
            ],
          }),
        })
      })
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: generateId,
        enableJsonResponse: true,
        onsessioninitialized: (sessionId) => {
          sessions.set(sessionId, { transport, actor })
        },
      })
      protocols.push(protocol)
      await protocol.connect(transport)
      session = { transport, actor }
    }
    await session.transport.handleRequest(request, response)
  } catch {
    if (!response.headersSent) response.writeHead(500)
    response.end()
  }
})

beforeAll(async () => {
  Object.assign(env, { REDIS_URL: readTestRedisUrl(), EGRESS_ALLOWED_HOSTS: '127.0.0.1' })
  await new Promise<void>((resolve) => providerServer.listen(0, '127.0.0.1', resolve))
  const address = providerServer.address()
  if (!address || typeof address === 'string') throw new Error('Fixture failed to bind')
  origin = `http://127.0.0.1:${address.port}/mcp`
  const guarded = pinnedFetch.createGuardedMcpFetch
  vi.spyOn(pinnedFetch, 'createGuardedMcpFetch').mockImplementation((url) => {
    if (!url || ![RESOURCE, NOTION_RESOURCE].includes(url))
      throw new Error('Unexpected MCP fixture origin')
    const transport = guarded(origin)
    openTransports.add(transport)
    return {
      fetch: (input, init) => {
        if (new URL(input instanceof Request ? input.url : input).href !== url)
          throw new Error('Unexpected MCP fixture destination')
        return transport.fetch(origin, init)
      },
      close: async () => {
        await transport.close()
        openTransports.delete(transport)
      },
    }
  })
  for (const actor of actors) {
    await db.insert(user).values({
      id: actor.userId,
      name: 'Session fixture',
      email: `${actor.userId}@fixture.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db
      .insert(organization)
      .values({ id: actor.organizationId, name: 'Session fixture', slug: actor.organizationId })
      .onConflictDoNothing()
    await db.insert(member).values({
      id: generateId(),
      organizationId: actor.organizationId,
      userId: actor.userId,
      role: 'owner',
    })
    const group = await ensureWorkspaceAccountsGroup(
      { kind: 'organization', organizationId: actor.organizationId },
      actor.userId
    )
    let serverId = serverIds.get(actor.organizationId)
    if (!serverId) {
      const { mcpServer } = await db.transaction((tx) =>
        createManagedMcpConnector(
          {
            organizationId: actor.organizationId,
            credentialGroupId: group.id,
            userId: actor.userId,
            validated: {
              input: { connectorId: actor.provider },
              url: actor.provider === 'notion' ? NOTION_RESOURCE : RESOURCE,
            },
          },
          tx
        )
      )
      serverId = mcpServer.id
      serverIds.set(actor.organizationId, serverId)
    }
    const { enrollment } = await createViewerCredentialGroupEnrollment({
      organizationId: actor.organizationId,
      credentialGroupId: group.id,
      userId: actor.userId,
    })
    await db
      .update(credentialGroupEnrollment)
      .set({ status: 'completed' })
      .where(eq(credentialGroupEnrollment.id, enrollment.id))
    await db.insert(credential).values({
      id: actor.credentialId,
      organizationId: actor.organizationId,
      type: 'managed_mcp',
      displayName: 'Session fixture',
      grantedAt: new Date(),
      credentialGroupEnrollmentId: enrollment.id,
      mcpServerId: serverId,
      mcpOauthConfigVersion: (
        await db
          .select({ version: mcpServers.oauthConfigVersion })
          .from(mcpServers)
          .where(eq(mcpServers.id, serverId))
      )[0].version,
      managedOauthStatus: 'active',
      mcpTools: [],
      encryptedOauthTokenSet: await encryptManagedMcpTokens({
        access_token: actor.token,
        token_type: 'Bearer',
      }),
    })
    await db
      .insert(organizationSearchIntegration)
      .values({
        organizationId: actor.organizationId,
        connectorType: actor.provider,
        approved: true,
      })
      .onConflictDoNothing()
  }
})

afterEach(async () => {
  for (const transport of openTransports) await transport.close()
  openTransports.clear()
})

afterAll(async () => {
  if (process.env.MANAGED_MCP_SESSION_REPORT_PATH) {
    await mkdir(dirname(process.env.MANAGED_MCP_SESSION_REPORT_PATH), { recursive: true })
    await writeFile(
      process.env.MANAGED_MCP_SESSION_REPORT_PATH,
      JSON.stringify({ measurements, events, openTransports: openTransports.size }, null, 2)
    )
  }
  await Promise.all(protocols.map((protocol) => protocol.close()))
  await new Promise<void>((resolve, reject) => {
    providerServer.close((error) => (error ? reject(error) : resolve()))
    providerServer.closeAllConnections()
  })
  await db.delete(organization).where(
    inArray(
      organization.id,
      actors.map((actor) => actor.organizationId)
    )
  )
  await db.delete(user).where(
    inArray(
      user.id,
      actors.map((actor) => actor.userId)
    )
  )
})

function search(index = 0, signal?: AbortSignal) {
  const actor = actors[index]
  return searchLiveKnowledge.execute({
    principal: createSessionPrincipal({ userId: actor.userId, sessionId: generateId() }),
    input: {
      organizationId: actor.organizationId,
      query: 'topology',
      topK: 10,
      filters: { source: 'lucid' },
      signal,
    },
  })
}
function read(documentId: string, index = 0, signal?: AbortSignal) {
  const actor = actors[index]
  return readLiveDocument.execute({
    principal: createSessionPrincipal({ userId: actor.userId, sessionId: generateId() }),
    input: {
      organizationId: actor.organizationId,
      documentId,
      limit: 8,
      resultSecretRegistry: new ResolvedSecretTraceRegistry([]),
      signal,
    },
  })
}

/** Actual SDK HTTP + current database grants, including final document verification. */
describe('managed Search operation sessions', () => {
  it('reads a complete diagram with one handshake per authorized operation and disposes both transports', async () => {
    setupDelay = 150
    try {
      const start = performance.now()
      const offset = events.length
      const found = await search()
      expect(found.results, JSON.stringify(found.live)).toHaveLength(1)
      const document = await read(found.results[0].documentId)
      expect(JSON.stringify(document)).toContain('Private diagram 0')
      const initializations = events
        .slice(offset)
        .filter((event) => event.method === 'initialize').length
      measurements.push({
        name: 'search and complete read',
        durationMs: performance.now() - start,
        initializations,
      })
      expect(openTransports.size).toBe(0)
      expect(initializations).toBe(2)
    } finally {
      setupDelay = 0
    }
  })
  it('multiplexes native queries on one connection without mixing their results', async () => {
    const actor = actors[0]
    const bothEntered = createDeferred<void>()
    const entered: string[] = []
    const finished: string[] = []
    const offset = events.length
    let timer: ReturnType<typeof setTimeout> | undefined
    onTool = async (name, args) => {
      if (name !== 'search') return
      const query = String(args.query)
      entered.push(query)
      if (entered.length === 1) timer = setTimeout(() => bothEntered.resolve(), 2_000)
      if (entered.length === 2) bothEntered.resolve()
      await bothEntered.promise
      expect(entered).toHaveLength(2)
      if (query === 'topology') await sleep(25)
      finished.push(query)
    }
    try {
      const found = await searchLiveKnowledge.execute({
        principal: createSessionPrincipal({ userId: actor.userId, sessionId: generateId() }),
        input: {
          organizationId: actor.organizationId,
          query: 'topology',
          topK: 10,
          filters: { source: 'lucid' },
          nativeQueries: [
            { provider: 'lucid', query: 'topology', kind: 'lucidchart' },
            { provider: 'lucid', query: 'second topology', kind: 'lucidchart' },
          ],
        },
      })
      expect(finished).toEqual(['second topology', 'topology'])
      expect(found.results.map((result) => result.documentName).sort()).toEqual([
        'Second topology',
        TITLE,
      ])
      expect(found.retrieval.status).toBe('complete')
      expect(
        found.live?.accounts.map(({ queryIndex, status }) => ({ queryIndex, status }))
      ).toEqual([
        { queryIndex: 0, status: 'ok' },
        { queryIndex: 1, status: 'ok' },
      ])
      expect(events.slice(offset).filter((event) => event.method === 'initialize')).toHaveLength(1)
      for (const result of found.results)
        expect(JSON.stringify(await read(result.documentId))).toContain(result.documentName)
      expect(openTransports.size).toBe(0)
    } finally {
      clearTimeout(timer)
      bothEntered.resolve()
      onTool = undefined
    }
  })
  it('binds folder continuations to account, folder, page size and filters', async () => {
    const browse = (
      index = 0,
      options: {
        cursor?: string
        project?: string
        topK?: number
        query?: string
        startDate?: string
        sortBy?: 'newest'
      } = {}
    ) => {
      const actor = actors[index]
      return searchLiveKnowledge.execute({
        principal: createSessionPrincipal({ userId: actor.userId, sessionId: generateId() }),
        input: {
          organizationId: actor.organizationId,
          query: '',
          topK: options.topK ?? 10,
          filters: {
            source: 'lucid',
            ...(options.startDate ? { startDate: options.startDate } : {}),
            ...(options.sortBy ? { sortBy: options.sortBy } : {}),
          },
          nativeQueries: [
            {
              provider: 'lucid',
              query: options.query ?? '',
              ...(options.query ? {} : { browse: 'folder' as const }),
              accountId: actor.credentialId,
              ...(options.cursor ? { cursor: options.cursor } : {}),
              ...(options.project ? { project: options.project } : {}),
            },
          ],
        },
      })
    }
    const first = await browse()
    expect(first.live?.accounts[0].folders).toEqual([{ id: '42', name: 'Architecture' }])
    const cursor = first.live?.accounts[0].nextCursor
    expect(cursor).toBeTruthy()
    expect((await browse(0, { cursor })).results).toHaveLength(1)
    const actor = actors[0]
    const parallel = await searchLiveKnowledge.execute({
      principal: createSessionPrincipal({ userId: actor.userId, sessionId: generateId() }),
      input: {
        organizationId: actor.organizationId,
        query: '',
        topK: 10,
        filters: { source: 'lucid' },
        nativeQueries: [
          { provider: 'lucid', query: '', browse: 'folder', accountId: actor.credentialId, cursor },
          {
            provider: 'lucid',
            query: '',
            browse: 'folder',
            accountId: actor.credentialId,
            project: '42',
          },
        ],
      },
    })
    expect(parallel.results.map((result) => result.documentName).sort()).toEqual([
      'Second topology',
      TITLE,
    ])

    for (const options of [{ project: '42' }, { topK: 5 }, { startDate: '2026-09-01T00:00:00Z' }]) {
      expect((await browse(0, options)).live?.accounts[0]?.status).not.toBe('unavailable')
      const result = await browse(0, { ...options, cursor })
      expect(result.results).toHaveLength(0)
      expect(result.live?.accounts[0]).toMatchObject({ status: 'unavailable' })
    }
    expect((await browse(2, { cursor })).live?.accounts[0]).toMatchObject({ status: 'unavailable' })
    expect((await browse(0, { cursor: `${cursor}tampered` })).live?.accounts[0]).toMatchObject({
      status: 'unavailable',
    })
    const sorted = await browse(0, { sortBy: 'newest' })
    expect(
      (await browse(0, { sortBy: 'newest', cursor: sorted.live?.accounts[0].nextCursor })).results
    ).toHaveLength(1)
    expect(openTransports.size).toBe(0)
  })
  it.each([
    { startDate: '2026-09-01T00:00:00Z' },
    { sortBy: 'newest' },
    { sortBy: 'oldest' },
  ] as const)(
    'rejects plain empty Lucid searches with %j before opening the provider',
    async (filters) => {
      const actor = actors[0]
      const before = events.length
      await expect(
        searchLiveKnowledge.execute({
          principal: createSessionPrincipal({ userId: actor.userId, sessionId: generateId() }),
          input: {
            organizationId: actor.organizationId,
            query: '',
            topK: 10,
            filters: { source: 'lucid', ...filters },
          },
        })
      ).rejects.toMatchObject({ code: 'validation' })
      expect(events.length).toBe(before)
    }
  )
  it('combines Lucid folder browsing and typed title search while preserving each query outcome', async () => {
    const actor = actors[0]
    const found = await searchLiveKnowledge.execute({
      principal: createSessionPrincipal({ userId: actor.userId, sessionId: generateId() }),
      input: {
        organizationId: actor.organizationId,
        query: '',
        topK: 10,
        filters: { source: 'lucid' },
        nativeQueries: [
          { provider: 'lucid', query: '', browse: 'folder', accountId: actor.credentialId },
          {
            provider: 'lucid',
            query: 'topology',
            kind: 'lucidchart',
            accountId: actor.credentialId,
          },
        ],
      },
    })
    expect(found.results).toHaveLength(1)
    expect(found.live?.accounts).toEqual([
      expect.objectContaining({
        queryIndex: 0,
        folders: [{ id: '42', name: 'Architecture' }],
        nextCursor: expect.any(String),
      }),
      expect.objectContaining({ queryIndex: 1, status: 'ok' }),
    ])
    expect(openTransports.size).toBe(0)
  })
  it.each(['newest', 'oldest'] as const)(
    'continues a plain Notion topical search sorted %s',
    async (sortBy) => {
      const actor = actors[3]
      const principal = createSessionPrincipal({ userId: actor.userId, sessionId: generateId() })
      const input = {
        organizationId: actor.organizationId,
        query: 'topology',
        topK: 10,
        filters: { source: 'notion' as const, sortBy },
      }
      const first = await searchLiveKnowledge.execute({ principal, input })
      expect(first.results, JSON.stringify(first.live)).toHaveLength(1)
      const cursor = first.live?.accounts[0].nextCursor
      expect(cursor).toBeTruthy()
      const next = await searchLiveKnowledge.execute({
        principal,
        input: {
          ...input,
          nativeQueries: [
            { provider: 'notion', query: input.query, accountId: actor.credentialId, cursor },
          ],
        },
      })
      expect(next.results, JSON.stringify(next.live)).toHaveLength(1)
      expect(next.results[0].documentId).not.toBe(first.results[0].documentId)
      expect(openTransports.size).toBe(0)
    }
  )
  it('binds Notion continuation to its sidebar mode and preserves independent page reads', async () => {
    const actor = actors[3]
    const browse = (mode: 'private' | 'shared', cursor?: string) =>
      searchLiveKnowledge.execute({
        principal: createSessionPrincipal({ userId: actor.userId, sessionId: generateId() }),
        input: {
          organizationId: actor.organizationId,
          query: '',
          topK: 10,
          filters: { source: 'notion' },
          nativeQueries: [
            {
              provider: 'notion',
              query: '',
              browse: mode,
              accountId: actor.credentialId,
              ...(cursor ? { cursor } : {}),
            },
          ],
        },
      })
    const first = await browse('private')
    expect(first.results, JSON.stringify(first.live)).toHaveLength(1)
    const cursor = first.live?.accounts[0].nextCursor
    expect(cursor).toBeTruthy()
    const next = await browse('private', cursor)
    expect(next.results).toHaveLength(1)
    expect(next.results[0].documentId).not.toBe(first.results[0].documentId)
    expect(JSON.stringify(await read(next.results[0].documentId, 3))).toContain(
      'Private page evidence'
    )
    expect((await browse('shared')).results).toHaveLength(1)
    const changed = await browse('shared', cursor)
    expect(changed.results).toHaveLength(0)
    expect(changed.live?.accounts[0].status).toBe('unavailable')
    expect(openTransports.size).toBe(0)
  })
  it('isolates simultaneous users and rejects another organization’s signed document reference', async () => {
    const results = await Promise.all([search(0), search(1)])
    const documents = await Promise.all(
      results.map((result, index) => read(result.results[0].documentId, index))
    )
    expect(JSON.stringify(documents[0])).toContain('Private diagram 0')
    expect(JSON.stringify(documents[0])).not.toContain('Private diagram 1')
    expect(JSON.stringify(documents[1])).toContain('Private diagram 1')
    const before = events.length
    await expect(read(results[0].results[0].documentId, 1)).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(events.length).toBe(before)
    expect(openTransports.size).toBe(0)
  })
  it('withholds a document revoked during content fetch and closes the transport', async () => {
    const found = await search()
    expect(found.results).toHaveLength(1)
    onTool = async (name, args) => {
      if (name === 'fetch' && !args.metadata_only)
        await db
          .update(credential)
          .set({ revokedAt: new Date() })
          .where(eq(credential.id, actors[0].credentialId))
    }
    try {
      await expect(read(found.results[0].documentId)).rejects.toMatchObject({ status: 'reconnect' })
      expect(openTransports.size).toBe(0)
    } finally {
      onTool = undefined
      await db
        .update(credential)
        .set({ revokedAt: null })
        .where(eq(credential.id, actors[0].credentialId))
    }
  })
  it('closes a connection when complete tool discovery fails', async () => {
    failDiscovery = true
    const offset = events.length
    try {
      const found = await search()
      expect(found.results).toHaveLength(0)
      expect(found.live?.accounts[0].status).toBe('unavailable')
      expect(events.slice(offset).map((event) => event.method)).toEqual([
        'initialize',
        'tools/list',
        'tools/list',
      ])
      expect(openTransports.size).toBe(0)
    } finally {
      failDiscovery = false
    }
  })
  it.each(['initialize', 'discovery', 'content'] as const)(
    'releases transport on cancellation during %s',
    async (phase) => {
      const found = await search()
      expect(found.results).toHaveLength(1)
      const entered = createDeferred<void>()
      const release = createDeferred<void>()
      const block = async () => {
        entered.resolve()
        await release.promise
      }
      const controller = new AbortController()
      if (phase === 'initialize') onInitialize = block
      else if (phase === 'discovery') onDiscovery = block
      else
        onTool = async (name, args) => {
          if (name === 'fetch' && !args.metadata_only) await block()
        }
      const pending = read(found.results[0].documentId, 0, controller.signal)
      const rejected = expect(pending).rejects.toThrow()
      try {
        await entered.promise
        controller.abort(new Error('Fixture caller cancelled'))
        await rejected
        expect(openTransports.size).toBe(0)
      } finally {
        onInitialize = undefined
        onDiscovery = undefined
        onTool = undefined
        release.resolve()
        await pending.catch(() => {})
      }
      const next = await search()
      expect(next.results).toHaveLength(1)
      expect(openTransports.size).toBe(0)
    }
  )

  it.each(['schema', 'budget'] as const)(
    'enforces the %s boundary before sending a tool request',
    async (boundary) => {
      const actor = actors[0]
      await runWithOutboundOrganization(actor.organizationId, async () => {
        const client = await createManagedSearchMcpClient(
          { organizationId: actor.organizationId },
          actor.userId,
          actor.credentialId,
          'lucid',
          AbortSignal.timeout(10_000)
        )
        try {
          if (boundary === 'budget') {
            for (let i = 0; i < 12; i++) await client.call('search', { query: 'topology' })
          }
          const before = events.length
          if (boundary === 'schema') {
            await expect(client.call('write_document', {})).rejects.toThrow('read-only')
            await expect(client.call('search', { query: 42 })).rejects.toThrow('schema')
          } else
            await expect(client.call('search', { query: 'topology' })).rejects.toThrow(
              'request limit'
            )
          expect(events.length).toBe(before)
        } finally {
          await client.close()
        }
      })
      expect(openTransports.size).toBe(0)
    }
  )

  it('does not retain transport when a persisted policy is invalid', async () => {
    await db
      .update(organization)
      .set({ metadata: { liveSearchPolicies: { lucid: { mode: 'invalid-policy' } } } })
      .where(eq(organization.id, actors[0].organizationId))
    try {
      const found = await search()
      expect(found.results).toHaveLength(0)
      expect(found.live?.accounts[0].status).toBe('unavailable')
      expect(openTransports.size).toBe(0)
    } finally {
      await db
        .update(organization)
        .set({ metadata: null })
        .where(eq(organization.id, actors[0].organizationId))
    }
  })

  it.each(['before', 'during'] as const)(
    'rejects revocation %s a call within an open operation',
    async (phase) => {
      const actor = actors[0]
      await runWithOutboundOrganization(actor.organizationId, async () => {
        const client = await createManagedSearchMcpClient(
          { organizationId: actor.organizationId },
          actor.userId,
          actor.credentialId,
          'lucid',
          AbortSignal.timeout(10_000)
        )
        const revoke = async () => {
          await db
            .update(credential)
            .set({ revokedAt: new Date() })
            .where(eq(credential.id, actor.credentialId))
        }
        try {
          await client.call('search', { query: 'topology' })
          if (phase === 'before') await revoke()
          else onTool = revoke
          const before = events.length
          await expect(client.call('search', { query: 'topology' })).rejects.toMatchObject({
            status: 'reconnect',
          })
          if (phase === 'before') expect(events.length).toBe(before)
        } finally {
          onTool = undefined
          await client.close()
          await db
            .update(credential)
            .set({ revokedAt: null })
            .where(eq(credential.id, actor.credentialId))
        }
      })
      expect(openTransports.size).toBe(0)
    }
  )

  it('keeps two personal grants on the same server in separate operation sessions', async () => {
    const [first, second] = await Promise.all([search(0), search(2)])
    const documents = await Promise.all([
      read(first.results[0].documentId, 0),
      read(second.results[0].documentId, 2),
    ])
    expect(JSON.stringify(documents[0])).toContain('Private diagram 0')
    expect(JSON.stringify(documents[0])).not.toContain('Private diagram 2')
    expect(JSON.stringify(documents[1])).toContain('Private diagram 2')
    expect(openTransports.size).toBe(0)
  })

  it('reloads a rotated persisted token after a challenge without sharing the operation session', async () => {
    const actor = actors[0]
    await runWithOutboundOrganization(actor.organizationId, async () => {
      const client = await createManagedSearchMcpClient(
        { organizationId: actor.organizationId },
        actor.userId,
        actor.credentialId,
        'lucid',
        AbortSignal.timeout(10_000)
      )
      try {
        await client.call('search', { query: 'topology' })
        actor.token = generateId()
        await db
          .update(credential)
          .set({
            encryptedOauthTokenSet: await encryptManagedMcpTokens({
              access_token: actor.token,
              token_type: 'Bearer',
            }),
          })
          .where(eq(credential.id, actor.credentialId))
        const before = events.length
        expect(await client.call('search', { query: 'topology' })).toMatchObject({
          results: [{ id: DOCUMENT }],
        })
        expect(events.slice(before).map((event) => event.method)).toEqual(['search'])
      } finally {
        await client.close()
      }
    })
    expect(openTransports.size).toBe(0)
  })

  it('rejects replacement of the grant inside an operation before sending another request', async () => {
    const actor = actors[0]
    await runWithOutboundOrganization(actor.organizationId, async () => {
      const client = await createManagedSearchMcpClient(
        { organizationId: actor.organizationId },
        actor.userId,
        actor.credentialId,
        'lucid',
        AbortSignal.timeout(10_000)
      )
      try {
        await client.call('search', { query: 'topology' })
        await db
          .update(credential)
          .set({ grantedAt: new Date() })
          .where(eq(credential.id, actor.credentialId))
        const before = events.length
        await expect(client.call('search', { query: 'topology' })).rejects.toThrow(
          'connection changed'
        )
        expect(events.length).toBe(before)
      } finally {
        await client.close()
      }
    })
    expect(openTransports.size).toBe(0)
  })
})
