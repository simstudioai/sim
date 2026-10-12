/**
 * Every Chat surface that can carry content from a provenance-bearing store, driven through the
 * real composition: Chat's CLI transport and the run_code sandbox proxy, the real routes and use
 * cases, real PostgreSQL and Redis. Each store holds one clean, one secret-bearing, one unknown and
 * (for files) one unrecorded item, so every case shows the per-item decision side by side.
 */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { rateLimiterMock } from '@sim/testing/mocks/rate-limiter.mock'
import { generateId } from '@sim/utils/id'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => {
  if (process.env.TEST_REDIS_URL) process.env.REDIS_URL = process.env.TEST_REDIS_URL
  return { root: '' }
})
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))
/** Admission throughput is not what this suite proves. */
vi.mock('@/lib/core/rate-limiter', () => rateLimiterMock)
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
/** The remote workbench itself is a third-party machine; only its identity is needed here. */
const workbench = vi.hoisted(() => ({ available: true }))
vi.mock('@/lib/execution/remote-sandbox/provider', () => ({
  resolveProvider: () => ({
    id: 'e2b',
    findSessionSandbox: async () => (workbench.available ? { sandboxId: 'fixture-sandbox' } : null),
  }),
}))
/** The run lease that owns a sandbox token is the tool executor's concern, not this boundary's. */
vi.mock('@/lib/mothership/async-runs/repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mothership/async-runs/repository')>()),
  isActiveSandboxResourceOwner: async () => true,
}))

import { db } from '@sim/db'
import { copilotChats, userTableRowSecretProvenance } from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { eq, sql } from 'drizzle-orm'
import contentRoutes from '@/lib/api/server/routes/copilot-content-routes.json'
import { matchV2Route } from '@/lib/api/server/routes/in-process-transport'
import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import { getRedisClient } from '@/lib/core/config/redis'
import {
  initializeSessionFileProvenance,
  readSessionSecretProvenance,
} from '@/lib/execution/remote-sandbox/session-file-provenance'
import {
  CANARY,
  type ContentFixture,
  ORIGIN,
  removeContentFixture,
  seedContentFixture,
  seedKnowledgeConnector,
} from '@/lib/mothership/__integration__/content-delivery-fixture'
import { createAgentCliTransport } from '@/lib/mothership/agent-cli/transport'
import { proxySandboxResourceRequest } from '@/lib/mothership/tools/sandbox-resource-transport'
import { chatSandboxSessionKey } from '@/lib/mothership/tools/sandbox-session-key'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const WORKBENCH = { providerId: 'e2b', sandboxId: 'fixture-sandbox' } as const

interface ChatRead {
  status: number
  /** The body as text; a zip is flattened to `name: content` lines. */
  body: string
  registry: ResolvedSecretTraceRegistry
}

/** What Chat's model receives: the body projected through the call's registry, as egress does. */
function modelView(read: ChatRead): string | undefined {
  const projection = projectResolvedSecretModelContent(
    read.body,
    read.registry.forkForPropagatedEntries()
  )
  return projection.safe && typeof projection.value === 'string' ? projection.value : undefined
}

async function bodyText(response: Response): Promise<string> {
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!(response.headers.get('content-type') ?? '').includes('zip')) return bytes.toString('utf8')
  const archive = await JSZip.loadAsync(bytes)
  const lines: string[] = []
  for (const name of Object.keys(archive.files).sort()) {
    if (!archive.files[name].dir)
      lines.push(`${name}: ${await archive.files[name].async('string')}`)
  }
  return lines.join('\n')
}

/**
 * Routes Chat may call whose content is not driven through a transport here, each with the
 * test that proves its gate instead. Running a workflow needs a deployed workflow and an executor;
 * the inline file bytes it returns are withheld by the same helper the run read uses, proven here.
 */
const PROVEN_ELSEWHERE: Record<string, string> = {
  'POST /api/v2/workflows/[workflowId]/execute':
    'lib/workflows/application/admit-run-files.test.ts (withholdUnadmittedInlineFiles)',
  'POST /api/v2/workflows/[workflowId]/runs/[runId]/resume':
    'lib/workflows/application/admit-run-files.test.ts (withholdUnadmittedInlineFiles)',
}

/** Each content route a case drove, as `METHOD /api/v2/...` in the inventory's `[param]` form. */
const exercised = new Set<string>()

function noteExercised(method: string, route: string) {
  const pathname = new URL(route, ORIGIN).pathname
  const matched = matchV2Route(pathname)
  if (matched) exercised.add(`${method} ${matched.pattern.replace(/\{([^}]+)\}/g, '[$1]')}`)
}

describe('content reaching Chat is admitted per item', () => {
  let fixture: ContentFixture
  let connector: { connectorId: string; documentId: string }

  beforeAll(async () => {
    fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-content-delivery-'))
    fixture = await seedContentFixture()
    connector = await seedKnowledgeConnector(fixture)
  }, 120_000)

  afterAll(async () => {
    if (fixture) await removeContentFixture(fixture)
    await rm(fixtureStorage.root, { recursive: true, force: true })
  })

  /** One Chat CLI request through the transport every CLI invocation and engine runs on. */
  async function cli(method: string, route: string, body?: unknown): Promise<ChatRead> {
    noteExercised(method, route)
    const registry = new ResolvedSecretTraceRegistry([], {
      userId: fixture.ids.aliceId,
      workspaceId: fixture.ids.workspaceId,
    })
    const transport = createAgentCliTransport({
      endpoint: ORIGIN,
      invocation: {
        userId: fixture.ids.aliceId,
        workspaceId: fixture.ids.workspaceId,
        chatId: generateId(),
      },
      registry,
      resources: [],
      observeReads: true,
    })
    const response = await withWorkspaceInvocationScope(
      { workspaceId: fixture.ids.workspaceId, organizationId: fixture.ids.organizationId },
      () =>
        transport(`${ORIGIN}${route}`, {
          method,
          ...(body === undefined
            ? {}
            : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
        })
    )
    return { status: response.status, body: await bodyText(response), registry }
  }

  /** One request from run_code's workbench through the private sandbox proxy. */
  async function sandbox(
    method: string,
    route: string,
    body?: unknown
  ): Promise<{ status: number; body: string; sessionKey: string }> {
    noteExercised(method, route)
    const token = generateId()
    const apiKey = `sandbox-${generateId()}`
    const chatId = generateId()
    await db.insert(copilotChats).values({
      id: chatId,
      userId: fixture.ids.aliceId,
      workspaceId: fixture.ids.workspaceId,
      type: 'mothership',
    })
    await getRedisClient()?.set(
      `mothership:sandbox-resources:${token}:context`,
      JSON.stringify({
        toolCallId: generateId(),
        runId: generateId(),
        userId: fixture.ids.aliceId,
        ownerToken: generateId(),
        chatId,
        workspaceId: fixture.ids.workspaceId,
        apiKeyHash: sha256Hex(apiKey),
      }),
      'EX',
      600
    )
    const sessionKey = chatSandboxSessionKey(chatId)
    /** A freshly created machine starts with clean history, as the sandbox session does. */
    await initializeSessionFileProvenance(sessionKey, WORKBENCH)
    const response = await proxySandboxResourceRequest(
      new Request(`${ORIGIN}/api/mothership/sandbox/${token}${route}`, {
        method,
        headers: {
          'x-api-key': apiKey,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      token
    )
    return { status: response.status, body: await bodyText(response), sessionKey }
  }

  function workbenchHistory(sessionKey: string) {
    return readSessionSecretProvenance(sessionKey, WORKBENCH)
  }

  const ws = () => fixture.ids.workspaceId
  const kbPath = () => `/api/v2/knowledge/${fixture.knowledge.knowledgeBaseId}`
  const chunksPath = () => `${kbPath()}/documents/${fixture.knowledge.documentId}/chunks`
  const runPath = () => `/api/v2/workflows/${fixture.run.workflowId}/runs/${fixture.run.runId}`

  /** Asserts the per-item outcome every collection case shares. */
  function expectPerItem(read: ChatRead, options: { secretAdmitted: boolean }) {
    expect(read.status).toBe(200)
    expect(read.body).not.toContain(CANARY.unknown)
    expect(read.body).toContain(CANARY.clean)
    expect(read.registry.isPermanentlyIncomplete()).toBe(false)
    const view = modelView(read)
    expect(view).toBeDefined()
    expect(view).toContain(CANARY.clean)
    expect(view).not.toContain(CANARY.secret)
    if (options.secretAdmitted) expect(read.body).toContain(CANARY.secret)
    else expect(read.body).not.toContain(CANARY.secret)
  }

  describe('Chat CLI', () => {
    it('zips only admitted files into a bulk download (P1/P2, #4)', async () => {
      const read = await cli(
        'GET',
        `/api/v2/files/bulk-download?workspaceId=${ws()}&fileIds=${Object.values(fixture.files)}`
      )
      expectPerItem(read, { secretAdmitted: false })
      expect(read.body).toContain(CANARY.unrecorded)
    })

    it('answers files search, dropping lines from refused files (#5, misroute)', async () => {
      const read = await cli(
        'GET',
        `/api/v2/files/search?workspaceId=${ws()}&query=${encodeURIComponent('PROVENANCE')}`
      )
      expect(read.status).toBe(200)
      const results: Array<{ fileId: string; text: string }> = JSON.parse(read.body).data.results
      const files = new Set(results.map((result) => result.fileId))
      expect(files.has(fixture.files.clean)).toBe(true)
      expect(files.has(fixture.files.unrecorded)).toBe(true)
      expect(files.has(fixture.files.unknown)).toBe(false)
      expect(read.body).not.toContain(CANARY.unknown)
      expect(read.registry.isPermanentlyIncomplete()).toBe(false)
    })

    it('refuses an unknown run file and redacts a secret-bearing one (#7)', async () => {
      const unknown = await cli('GET', `${runPath()}/files/${fixture.run.files.unknown}`)
      expect(unknown.status).toBe(403)
      expect(unknown.body).not.toContain(CANARY.unknown)
      expect(unknown.registry.isPermanentlyIncomplete()).toBe(false)

      const entries = await cli('GET', `${runPath()}/files/${fixture.run.files.entries}`)
      expect(entries.status).toBe(200)
      expect(modelView(entries)).not.toContain(CANARY.secret)

      const clean = await cli('GET', `${runPath()}/files/${fixture.run.files.clean}`)
      expect(clean.status).toBe(200)
      expect(modelView(clean)).toContain(CANARY.clean)
    })

    it('inlines only clean run files as base64 (#8)', async () => {
      const read = await cli('GET', `${runPath()}?includeOutput=true&includeFileBase64=true`)
      expect(read.status).toBe(200)
      const files: Array<{ id: string; base64: string | null }> = JSON.parse(read.body).data.files
      const byId = new Map(files.map((file) => [file.id, file.base64]))
      expect(byId.get(fixture.run.files.clean)).toBeTruthy()
      expect(byId.get(fixture.run.files.unknown)).toBeNull()
      expect(byId.get(fixture.run.files.entries)).toBeNull()
      expect(read.registry.isPermanentlyIncomplete()).toBe(false)
    })

    it('lists only admitted knowledge chunks and refuses an unknown one (#10)', async () => {
      const list = await cli('GET', `${chunksPath()}?workspaceId=${ws()}`)
      expectPerItem(list, { secretAdmitted: true })

      const unknown = await cli(
        'GET',
        `${chunksPath()}/${fixture.knowledge.chunks.unknown}?workspaceId=${ws()}`
      )
      expect(unknown.status).toBe(403)
      expect(unknown.body).not.toContain(CANARY.unknown)
    })

    it('searches knowledge per chunk instead of withholding the whole search (#11, O5)', async () => {
      const read = await cli('POST', '/api/v2/knowledge/search', {
        workspaceId: ws(),
        knowledgeBaseIds: [fixture.knowledge.knowledgeBaseId],
        query: 'second line',
      })
      expectPerItem(read, { secretAdmitted: true })
    })

    it('does not admit Chat to a whole knowledge base export (#12)', async () => {
      const read = await cli('GET', `${kbPath()}/export?workspaceId=${ws()}`)
      expect(read.status).toBe(403)
      expect(read.body).not.toContain(CANARY.unknown)
    })

    it('returns table rows per row instead of withholding the page (#18, O5)', async () => {
      const read = await cli(
        'GET',
        `/api/v2/tables/${fixture.table.tableId}/rows?workspaceId=${ws()}`
      )
      expectPerItem(read, { secretAdmitted: true })
    })

    it('refuses predicates over a table whose cells it cannot vouch for (#18b)', async () => {
      const table = `/api/v2/tables/${fixture.table.tableId}`
      const guess = { field: 'note', op: 'contains', value: 'second' }
      const refused = [
        await cli('POST', `${table}/rows/search`, { workspaceId: ws(), q: 'second' }),
        await cli('POST', `${table}/query`, { workspaceId: ws(), predicate: guess, limit: 1 }),
        await cli('POST', `${table}/query/count`, { workspaceId: ws(), predicate: guess }),
      ]
      for (const read of refused) {
        expect(read.status).toBe(403)
        expect(read.body).not.toContain(CANARY.unknown)
        expect(read.body).not.toContain(CANARY.secret)
      }
      /** The same predicate reads nothing but row ids, so it stays available. */
      const byId = await cli('POST', `${table}/query`, {
        workspaceId: ws(),
        predicate: { field: 'id', op: 'in', value: [fixture.table.rows.clean] },
      })
      expect(byId.status).toBe(200)
      expect(modelView(byId)).toContain(CANARY.clean)
    })

    it('runs predicates over a table whose every cell is vouched for', async () => {
      const created = await cli('POST', '/api/v2/tables', {
        workspaceId: ws(),
        name: `clean_${generateId().slice(0, 8)}`,
        schema: { columns: [{ name: 'note', type: 'string' }] },
      })
      expect(created.status).toBe(201)
      const table = `/api/v2/tables/${JSON.parse(created.body).data.id}`
      for (const note of ['alpha second', 'beta']) {
        expect(
          (await cli('POST', `${table}/rows`, { workspaceId: ws(), data: { note } })).status
        ).toBe(201)
      }
      const guess = { field: 'note', op: 'contains', value: 'second' }
      const search = await cli('POST', `${table}/rows/search`, { workspaceId: ws(), q: 'second' })
      expect(search.status).toBe(200)
      expect(JSON.parse(search.body).data.matches).toHaveLength(1)
      const query = await cli('POST', `${table}/query`, { workspaceId: ws(), predicate: guess })
      expect(query.status).toBe(200)
      expect(modelView(query)).toContain('alpha second')
      const count = await cli('POST', `${table}/query/count`, {
        workspaceId: ws(),
        predicate: guess,
      })
      expect(count.status).toBe(200)

      /** A sidecar that claims exact but holds no valid entry list vouches for nothing. */
      const malformed = await cli('POST', `${table}/rows`, {
        workspaceId: ws(),
        data: { note: 'gamma' },
      })
      await db
        .update(userTableRowSecretProvenance)
        .set({ entries: sql`'{"not":"a list"}'::jsonb` })
        .where(eq(userTableRowSecretProvenance.rowId, JSON.parse(malformed.body).data.id))
      const afterCorruption = await cli('POST', `${table}/query`, {
        workspaceId: ws(),
        predicate: guess,
      })
      expect(afterCorruption.status).toBe(403)
    })

    it('shares only clean files publicly on Chat’s behalf (#9, D1)', async () => {
      const share = (fileId: string) =>
        cli('PATCH', `/api/v2/files/${fileId}/share`, {
          workspaceId: ws(),
          isActive: true,
          authType: 'public',
        })
      expect((await share(fixture.files.unknown)).status).toBe(403)
      expect((await share(fixture.files.entries)).status).toBe(403)
      expect((await share(fixture.files.clean)).status).toBe(200)
    })
    it('reads one file directly: clean as is, secrets redacted, unknown withheld whole (#1, D7)', async () => {
      const download = (fileId: string) => cli('GET', `/api/v2/files/${fileId}?workspaceId=${ws()}`)
      const clean = await download(fixture.files.clean)
      expect(clean.status).toBe(200)
      expect(modelView(clean)).toContain(CANARY.clean)

      const entries = await download(fixture.files.entries)
      expect(entries.status).toBe(200)
      expect(modelView(entries)).toBeDefined()
      expect(modelView(entries)).not.toContain(CANARY.secret)

      /** The single-file exception: delivered for the workbench, never shown to the model. */
      const unknown = await download(fixture.files.unknown)
      expect(unknown.status).toBe(200)
      expect(unknown.registry.isPermanentlyIncomplete()).toBe(true)
      expect(modelView(unknown)).toBeUndefined()
    })

    it('reads file text per file and refuses unknown text (#2)', async () => {
      const text = (fileId: string) =>
        cli('GET', `/api/v2/files/${fileId}/text?workspaceId=${ws()}`)
      const clean = await text(fixture.files.clean)
      expect(clean.status).toBe(200)
      expect(modelView(clean)).toContain(CANARY.clean)

      const entries = await text(fixture.files.entries)
      expect(entries.status).toBe(200)
      expect(modelView(entries)).not.toContain(CANARY.secret)

      const unknown = await text(fixture.files.unknown)
      expect(unknown.status).toBe(403)
      expect(unknown.body).not.toContain(CANARY.unknown)
      expect(unknown.registry.isPermanentlyIncomplete()).toBe(false)
    })

    it('reads a historical version as text under its own classification (#3)', async () => {
      const version = (fileId: string) =>
        cli('GET', `/api/v2/files/${fileId}/versions/1/text?workspaceId=${ws()}`)
      const clean = await version(fixture.files.clean)
      expect(clean.status).toBe(200)
      expect(modelView(clean)).toContain(CANARY.clean)

      const unknown = await version(fixture.files.unknown)
      expect(unknown.status).toBe(403)
      expect(unknown.body).not.toContain(CANARY.unknown)
    })

    it('refuses an edit whose search would probe unknown text, and edits a clean file (#22)', async () => {
      const edit = (fileId: string) =>
        cli('PATCH', `/api/v2/files/${fileId}/content`, {
          workspaceId: ws(),
          edit: { mode: 'search_replace', search: 'tainted', content: 'probed' },
        })
      const unknown = await edit(fixture.files.unknown)
      expect(unknown.status).toBe(403)
      expect(unknown.body).not.toContain(CANARY.unknown)

      const scratch = await uploadWorkspaceFile(
        ws(),
        fixture.ids.aliceId,
        Buffer.from('scratch notes tainted once'),
        `scratch-${generateId()}.txt`,
        'text/plain',
        { secretProvenance: { status: 'exact', entries: [] }, notifyWorkspaceChange: false }
      )
      expect((await edit(scratch.id)).status).toBe(200)
    })

    it('replaces a file’s content without reading what it held (#22)', async () => {
      const scratch = await uploadWorkspaceFile(
        ws(),
        fixture.ids.aliceId,
        Buffer.from(`replaced ${CANARY.unknown}`),
        `replace-${generateId()}.txt`,
        'text/plain',
        { secretProvenance: { status: 'unknown' }, notifyWorkspaceChange: false }
      )
      const write = await cli('PUT', `/api/v2/files/${scratch.id}/content`, {
        workspaceId: ws(),
        content: 'fresh content',
      })
      expect(write.status).toBe(200)
      expect(write.body).not.toContain(CANARY.unknown)
    })

    it('reads a share’s state only for a file Chat could share (#9)', async () => {
      const read = (fileId: string) =>
        cli('GET', `/api/v2/files/${fileId}/share?workspaceId=${ws()}`)
      expect((await read(fixture.files.clean)).status).toBe(200)
      const unknown = await read(fixture.files.unknown)
      /** An unshared file's share state names no content, so it reads like any other. */
      expect(unknown.status).toBe(200)
      expect(unknown.body).not.toContain(CANARY.unknown)
    })

    it('lists, reads and updates knowledge documents by their own metadata (#13)', async () => {
      const list = await cli('GET', `${kbPath()}/documents?workspaceId=${ws()}`)
      expect(list.status).toBe(200)
      expect(list.body).toContain(fixture.knowledge.documentId)

      const synced = await cli(
        'GET',
        `${kbPath()}/connectors/${connector.connectorId}/documents?workspaceId=${ws()}`
      )
      expect(synced.status).toBe(200)
      expect(synced.body).toContain(connector.documentId)

      const read = await cli(
        'GET',
        `${kbPath()}/documents/${fixture.knowledge.documentId}?workspaceId=${ws()}`
      )
      expect(read.status).toBe(200)
      expect(read.body).not.toContain(CANARY.unknown)

      const update = await cli('PATCH', `${kbPath()}/documents/${fixture.knowledge.documentId}`, {
        workspaceId: ws(),
        enabled: true,
      })
      expect(update.status).toBe(200)
      expect(update.body).not.toContain(CANARY.unknown)

      const usage = await cli('GET', `${kbPath()}/tags/usage?workspaceId=${ws()}`)
      expect(usage.status).toBe(200)
      expect(usage.body).not.toContain(CANARY.unknown)
    })

    it('creates and updates chunks without echoing unknown content (#10)', async () => {
      const created = await cli('POST', chunksPath(), {
        workspaceId: ws(),
        content: 'chat wrote this chunk',
      })
      expect(created.status).toBe(201)
      expect(modelView(created)).toContain('chat wrote this chunk')

      const updated = await cli('PATCH', `${chunksPath()}/${fixture.knowledge.chunks.unknown}`, {
        workspaceId: ws(),
        enabled: true,
      })
      /** The toggle commits and is audited; the chunk it would echo stays unknown, so is refused. */
      expect(updated.status).toBe(403)
      expect(updated.body).not.toContain(CANARY.unknown)
    })

    it('queries, counts and reads table rows per row (#18)', async () => {
      const table = `/api/v2/tables/${fixture.table.tableId}`
      const query = await cli('POST', `${table}/query`, { workspaceId: ws() })
      expectPerItem(query, { secretAdmitted: true })

      const count = await cli('POST', `${table}/query/count`, { workspaceId: ws() })
      expect(count.status).toBe(200)

      const clean = await cli(
        'GET',
        `${table}/rows/${fixture.table.rows.clean}?workspaceId=${ws()}`
      )
      expect(clean.status).toBe(200)
      expect(modelView(clean)).toContain(CANARY.clean)

      const unknown = await cli(
        'GET',
        `${table}/rows/${fixture.table.rows.unknown}?workspaceId=${ws()}`
      )
      expect(unknown.status).toBe(403)
      expect(unknown.body).not.toContain(CANARY.unknown)

      const enrichment = await cli(
        'GET',
        `${table}/rows/${fixture.table.rows.unknown}/enrichment/${generateId()}?workspaceId=${ws()}`
      )
      expect(enrichment.status).toBe(404)
      expect(enrichment.body).not.toContain(CANARY.unknown)
    })

    it('writes rows and returns only what a write may show (#18)', async () => {
      const table = `/api/v2/tables/${fixture.table.tableId}`
      const created = await cli('POST', `${table}/rows`, {
        workspaceId: ws(),
        data: { note: 'chat row' },
      })
      expect(created.status).toBe(201)
      expect(modelView(created)).toContain('chat row')

      const updated = await cli('PATCH', `${table}/rows/${fixture.table.rows.unknown}`, {
        workspaceId: ws(),
        data: { note: 'overwritten by chat' },
      })
      /** A row once unknown stays unknown after a partial write, so the echo is refused. */
      expect(updated.status).toBe(403)
      expect(updated.body).not.toContain(CANARY.unknown)

      const keyed = await cli('POST', '/api/v2/tables', {
        workspaceId: ws(),
        name: `keyed_${generateId().slice(0, 8)}`,
        schema: { columns: [{ name: 'key', type: 'string', unique: true }] },
      })
      expect(keyed.status).toBe(201)
      const keyedId: string = JSON.parse(keyed.body).data.id
      const upsert = () =>
        cli('POST', `/api/v2/tables/${keyedId}/rows/upsert`, {
          workspaceId: ws(),
          data: { key: 'chat-upserted' },
        })
      for (const write of [await upsert(), await upsert()]) {
        expect(write.status).toBe(200)
        expect(modelView(write)).toContain('chat-upserted')
      }
    })
  })

  describe('run_code sandbox proxy', () => {
    it('refuses an unknown file read without tainting the workbench (O1)', async () => {
      const read = await sandbox(
        'GET',
        `/api/v2/files/${fixture.files.unknown}?workspaceId=${ws()}`
      )
      expect(read.status).toBe(403)
      expect(read.body).not.toContain(CANARY.unknown)
      expect(await workbenchHistory(read.sessionKey)).toEqual({ status: 'exact', entries: [] })
    })

    it('records the entries of a secret-bearing read in the workbench history', async () => {
      const read = await sandbox(
        'GET',
        `/api/v2/files/${fixture.files.entries}?workspaceId=${ws()}`
      )
      expect(read.status).toBe(200)
      const history = await workbenchHistory(read.sessionKey)
      expect(history.status).toBe('exact')
      expect(history.status === 'exact' && history.entries.length).toBe(1)
    })

    it('zips and searches only admitted files (P1)', async () => {
      const zip = await sandbox(
        'GET',
        `/api/v2/files/bulk-download?workspaceId=${ws()}&fileIds=${Object.values(fixture.files)}`
      )
      expect(zip.status).toBe(200)
      expect(zip.body).toContain(CANARY.clean)
      expect(zip.body).not.toContain(CANARY.unknown)

      const search = await sandbox(
        'GET',
        `/api/v2/files/search?workspaceId=${ws()}&query=${encodeURIComponent('PROVENANCE')}`
      )
      expect(search.status).toBe(200)
      expect(search.body).not.toContain(fixture.files.unknown)
      expect((await workbenchHistory(search.sessionKey)).status).toBe('exact')
    })

    it('refuses table export download links and unknown run files (#17, #7)', async () => {
      const exportLink = await sandbox(
        'GET',
        `/api/v2/tables/${fixture.table.tableId}/exports/${generateId()}/download?workspaceId=${ws()}`
      )
      expect(exportLink.status).toBe(403)

      const runFile = await sandbox('GET', `${runPath()}/files/${fixture.run.files.unknown}`)
      expect(runFile.status).toBe(403)
      expect(runFile.body).not.toContain(CANARY.unknown)
    })

    it('completes a write whose result cannot be recorded, then withholds it (502)', async () => {
      const note = `committed ${generateId()}`
      workbench.available = false
      let write: Awaited<ReturnType<typeof sandbox>>
      try {
        write = await sandbox('POST', `/api/v2/tables/${fixture.table.tableId}/rows`, {
          workspaceId: ws(),
          data: { note },
        })
      } finally {
        workbench.available = true
      }
      expect(write.status).toBe(502)
      expect(write.body).not.toContain(note)
      expect(write.body).toContain('Do not retry a mutation automatically')
      const rows = await cli(
        'GET',
        `/api/v2/tables/${fixture.table.tableId}/rows?workspaceId=${ws()}`
      )
      expect(rows.body).toContain(note)
    })

    it('excludes unknown knowledge chunks and table rows (#10, #18)', async () => {
      const chunks = await sandbox('GET', `${chunksPath()}?workspaceId=${ws()}`)
      expect(chunks.status).toBe(200)
      expect(chunks.body).toContain(CANARY.clean)
      expect(chunks.body).not.toContain(CANARY.unknown)

      const rows = await sandbox(
        'GET',
        `/api/v2/tables/${fixture.table.tableId}/rows?workspaceId=${ws()}`
      )
      expect(rows.status).toBe(200)
      expect(rows.body).toContain(CANARY.clean)
      expect(rows.body).not.toContain(CANARY.unknown)
      expect((await workbenchHistory(rows.sessionKey)).status).toBe('exact')
    })
  })

  it('drives every content route Chat may call, or names the test that proves it', () => {
    const missing = contentRoutes
      .map((route) => `${route.method} ${route.path}`)
      .filter((key) => !exercised.has(key) && !PROVEN_ELSEWHERE[key])
    expect(missing).toEqual([])
  })
})
