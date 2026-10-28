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
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
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
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
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

/** Provider bytes are synthetic; generic-tool execution and its private metadata consumer are real. */
const toolProvider = vi.hoisted(() => ({ response: undefined as Response | undefined }))
vi.mock('@/lib/internal/tool-operations/registry.server', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/internal/tool-operations/registry.server')>()
  return {
    ...actual,
    getInternalToolOperationHandler: async (toolId: string) => {
      if (toolId === 'file_get_content' && toolProvider.response) {
        const response = toolProvider.response
        return async () => response
      }
      return actual.getInternalToolOperationHandler(toolId)
    },
  }
})

/** Only the external media providers are replaced; file admission and stored revisions are real. */
const mediaProvider = vi.hoisted(() => ({ calls: [] as unknown[] }))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      async generateContent(input: unknown) {
        mediaProvider.calls.push(input)
        throw new Error('fixture media provider reached')
      },
    }
  },
}))
vi.mock('@/lib/core/config/api-keys', () => ({ getRotatingApiKey: () => 'fixture-api-key' }))
vi.mock('@/lib/media/falai-audio', () => ({
  async generateFalAudio(input: unknown) {
    mediaProvider.calls.push(input)
    throw new Error('fixture media provider reached')
  },
}))
vi.mock('@/lib/media/falai-video', () => ({
  async generateFalVideo(input: unknown) {
    mediaProvider.calls.push(input)
    throw new Error('fixture media provider reached')
  },
}))

import { db } from '@sim/db'
import {
  changelogRelease,
  copilotChats,
  userTableRowSecretProvenance,
  workflowTest,
  workspaceFileSearchRevision,
  workspaceFiles,
} from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { eq, sql } from 'drizzle-orm'
import contentRoutes from '@/lib/api/server/routes/copilot-content-routes.json'
import { matchV2Route } from '@/lib/api/server/routes/in-process-transport'
import { observeContentDelivery } from '@/lib/core/application'
import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import { getRedisClient } from '@/lib/core/config/redis'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
  serializePrivateToolMetadataResponseEnvelope,
} from '@/lib/execution/private-tool-metadata'
import {
  initializeSessionFileProvenance,
  readSessionSecretProvenance,
} from '@/lib/execution/remote-sandbox/session-file-provenance'
import {
  CANARY,
  type ContentFixture,
  callV2,
  ORIGIN,
  removeContentFixture,
  seedContentFixture,
  seedKnowledgeConnector,
} from '@/lib/mothership/__integration__/content-delivery-fixture'
import { observePrivateFile } from '@/lib/mothership/agent-cli/engines/observe-private-file'
import { createAgentCliTransport } from '@/lib/mothership/agent-cli/transport'
import { createWorkbenchFileProvenance } from '@/lib/mothership/agent-cli/workbench-file-provenance'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'
import { createRegistryContentGate } from '@/lib/mothership/content-delivery/registry-gate'
import { proxySandboxResourceRequest } from '@/lib/mothership/tools/sandbox-resource-transport'
import { chatSandboxSessionKey } from '@/lib/mothership/tools/sandbox-session-key'
import { generateImageServerTool } from '@/lib/mothership/tools/server/image/generate-image'
import { generateAudioServerTool } from '@/lib/mothership/tools/server/media/generate-audio'
import { generateVideoServerTool } from '@/lib/mothership/tools/server/media/generate-video'
import { getShareForResource } from '@/lib/public-shares/manager'
import { TABLE_DELEGATION_AUDIENCE } from '@/lib/table/application/authorization'
import { queryTableRows } from '@/lib/table/application/rows'
import {
  createOwnedWorkspaceFile,
  getWorkspaceFile,
  updateWorkspaceFileContent as replaceFixtureFileContent,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/file-manager'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import { resolveServableDoc } from '@/lib/uploads/documents/compile'
import { storeCompiledDoc } from '@/lib/uploads/documents/compiled-store'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'
import { downloadWorkspaceFileItems } from '@/lib/workspace-files/application/download-workspace-file-items'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'
import { readWorkspaceFileSecretProvenance } from '@/lib/workspace-files/application/read-workspace-file-secret-provenance'
import {
  getWorkspaceFileShares,
  updateWorkspaceFileShare,
} from '@/lib/workspace-files/application/share-workspace-file'
import { indexWorkspaceFileForSearch } from '@/lib/workspace-files/search/indexing'
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
  let redis: NonNullable<ReturnType<typeof getRedisClient>>
  let fixture: ContentFixture
  let connector: { connectorId: string; documentId: string }

  beforeAll(async () => {
    fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-content-delivery-'))
    const client = getRedisClient()
    if (!client)
      throw new Error(
        'Set TEST_REDIS_URL to a disposable local Redis or use bun run test:integration'
      )
    redis = client
    // Compile the lazy tool graph before request deadlines and per-case provider fixtures exist.
    await matchV2Route('/api/v2/tools/file_get_content/execute')?.load()
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
      files: createWorkbenchFileProvenance({
        userId: fixture.ids.aliceId,
        workspaceId: fixture.ids.workspaceId,
        sessionKey: generateId(),
        resolvedSecretTraceRegistry: registry,
      }),
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
    await redis.set(
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

  describe('generic tool route and private provider envelopes', () => {
    async function providerResponse(options: { complete: boolean; success: boolean }) {
      const envelope = serializePrivateToolMetadataResponseEnvelope(
        options.success
          ? { success: true, data: { content: `provider content ${CANARY.secret}` } }
          : { success: false, error: `provider refused ${CANARY.secret}` },
        RESOLVED_SECRET_PROVENANCE_METADATA_V1,
        {
          version: 1,
          complete: options.complete,
          scope: { userId: fixture.ids.aliceId, workspaceId: ws() },
          entries: options.complete
            ? [
                {
                  name: 'PROVIDER_TOKEN',
                  encryptedValue: (await encryptSecret(CANARY.secret)).encrypted,
                },
              ]
            : [],
        }
      )
      toolProvider.response = Response.json(envelope.body, {
        status: options.success ? 200 : 400,
        headers: envelope.headers,
      })
    }

    it.each([true, false])(
      'projects private provider evidence through the CLI tool route (success=%s)',
      async (success) => {
        await providerResponse({ complete: true, success })
        try {
          const read = await cli('POST', '/api/v2/tools/file_get_content/execute', {
            workspaceId: ws(),
            input: { fileId: fixture.files.entries },
          })
          expect(read.status).toBe(200)
          expect(JSON.parse(read.body).data.status).toBe(success ? 'succeeded' : 'failed')
          expect(modelView(read)).toContain('{{PROVIDER_TOKEN}}')
          expect(modelView(read)).not.toContain(CANARY.secret)
          expect(read.registry.isPermanentlyIncomplete()).toBe(false)
        } finally {
          toolProvider.response = undefined
        }
      }
    )

    it('withholds an incomplete private provider envelope after the generic tool settles', async () => {
      await providerResponse({ complete: false, success: true })
      try {
        const read = await cli('POST', '/api/v2/tools/file_get_content/execute', {
          workspaceId: ws(),
          input: { fileId: fixture.files.unknown },
        })
        expect(read.status).not.toBe(200)
        expect(read.body).not.toContain(CANARY.secret)
        expect(read.body).toMatch(/settled|completed/)
        expect(read.body).toMatch(/do not retry/i)
        expect(read.registry.isPermanentlyIncomplete()).toBe(false)
      } finally {
        toolProvider.response = undefined
      }
    })

    it('records private provider evidence before sandbox tool response bytes are released', async () => {
      await providerResponse({ complete: true, success: true })
      try {
        const read = await sandbox('POST', '/api/v2/tools/file_get_content/execute', {
          workspaceId: ws(),
          input: { fileId: fixture.files.entries },
        })
        expect(read.status).toBe(200)
        expect(read.body).toContain(CANARY.secret)
        expect(await workbenchHistory(read.sessionKey)).toMatchObject({
          status: 'exact',
          entries: [{ name: 'PROVIDER_TOKEN' }],
        })
      } finally {
        toolProvider.response = undefined
      }
    })
  })

  describe('Chat CLI', () => {
    it('reports omitted files in a partial bulk download (P1/P2, #4)', async () => {
      const read = await cli(
        'GET',
        `/api/v2/files/bulk-download?workspaceId=${ws()}&fileIds=${Object.values(fixture.files)}`
      )
      expectPerItem(read, { secretAdmitted: false })
      expect(read.body).toContain(CANARY.unrecorded)
      expect(read.body).toContain('sim-download-report.json')
      expect(read.body).toContain(fixture.files.unknown)
      expect(read.body).toContain(fixture.files.entries)
    })

    it.each([
      'uncached',
      'cached',
      'recovered',
      'user-error',
      'subsequent-error',
      'copied-error',
      'mutated-refusal',
    ] as const)('keeps generated-document refusals per item (%s archive)', async (kind) => {
      const input = fixture.files.unknown
      const read = `await getFileBase64('${input}');`
      const code =
        kind === 'recovered'
          ? `try { ${read} } catch {} pdf.addPage().drawText('safe fallback');`
          : kind === 'user-error'
            ? `const error = new Error('File cannot be sent to a model because its secret provenance is unavailable'); error.name = 'ContentRefusedError'; throw error;`
            : kind === 'subsequent-error'
              ? `try { ${read} } catch {} throw new Error('fixture compiler failure');`
              : kind === 'copied-error'
                ? `try { ${read} } catch (error) { throw Object.assign(new Error(error.message), error); }`
                : kind === 'mutated-refusal'
                  ? `try { ${read} } catch (error) { error.message = 'fixture reworded refusal'; throw error; }`
                  : `${read} pdf.addPage().drawText('fixture render');`
      const document = await uploadWorkspaceFile(
        ws(),
        fixture.ids.aliceId,
        Buffer.from(`const archiveFixture = '${generateId()}'; ${code}`),
        `archive-refusal-${generateId()}.pdf`,
        'text/x-python-pdf',
        { notifyWorkspaceChange: false, secretProvenance: { status: 'exact', entries: [] } }
      )
      if (kind === 'cached') {
        const warmed = await downloadWorkspaceFileItems.execute({
          principal: createSessionPrincipal({ userId: fixture.ids.aliceId }),
          input: { workspaceId: ws(), fileIds: [document.id], folderIds: [] },
        })
        expect(warmed.renderedDocuments.get(document.id)?.subarray(0, 4).toString()).toBe('%PDF')
      }
      const route = `/api/v2/files/bulk-download?workspaceId=${ws()}&fileIds=`
      const mixed = await cli('GET', `${route}${fixture.files.clean},${document.id}`)
      if (kind === 'user-error' || kind === 'subsequent-error' || kind === 'copied-error') {
        expect(mixed.status).toBe(500)
        expect(mixed.body).toContain('INTERNAL_ERROR')
        return
      }
      expect(mixed.status, mixed.body).toBe(200)
      expect(mixed.body).toContain(CANARY.clean)
      expect(mixed.body).not.toContain(CANARY.unknown)
      expect(mixed.registry.isPermanentlyIncomplete()).toBe(false)
      if (kind === 'recovered') {
        expect(mixed.body).toContain('%PDF')
        expect(mixed.body).not.toContain('sim-download-report.json')
      } else {
        expect(mixed.body).not.toContain('%PDF')
        expect(mixed.body).toContain('sim-download-report.json')
        expect(mixed.body).toContain(document.id)
        const alone = await cli('GET', `${route}${document.id}`)
        expect(alone.status, alone.body).toBe(403)
        expect(alone.body).not.toContain(CANARY.unknown)
      }
    })

    it('answers files search with locations and withheld unreadable previews (#5, misroute)', async () => {
      const read = await cli(
        'GET',
        `/api/v2/files/search?workspaceId=${ws()}&query=${encodeURIComponent('PROVENANCE')}`
      )
      expect(read.status).toBe(200)
      const results: Array<{ fileId: string; text: string }> = JSON.parse(read.body).data.results
      const files = new Set(results.map((result) => result.fileId))
      expect(files.has(fixture.files.clean)).toBe(true)
      expect(files.has(fixture.files.unrecorded)).toBe(true)
      expect(files.has(fixture.files.unknown)).toBe(true)
      expect(results.find((result) => result.fileId === fixture.files.unknown)?.text).toMatch(
        /preview withheld/i
      )
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

    it('exports the allowed knowledge scope without including restricted documents (#12)', async () => {
      const read = await cli('GET', `${kbPath()}/export?workspaceId=${ws()}`)
      expect(read.status).toBe(200)
      expect(read.body).toContain('manifest.json')
      expect(read.body).not.toContain(CANARY.unknown)
    })

    it('returns table rows per row instead of withholding the page (#18, O5)', async () => {
      const read = await cli(
        'GET',
        `/api/v2/tables/${fixture.table.tableId}/rows?workspaceId=${ws()}`
      )
      expectPerItem(read, { secretAdmitted: true })
    })

    it('exports private evidence only for rows delivered by the mixed Chat page', async () => {
      const scope = { userId: fixture.ids.aliceId, workspaceId: ws() }
      const registry = new ResolvedSecretTraceRegistry([], scope)
      const result = await observeContentDelivery(
        createRegistryContentGate({ registry, actorUserId: scope.userId, workspaceId: ws() }),
        () =>
          queryTableRows.execute({
            principal: createCopilotChatPrincipal(scope, TABLE_DELEGATION_AUDIENCE, {
              tableId: fixture.table.tableId,
            }),
            input: { tableId: fixture.table.tableId, includePersistedSecretProvenance: true },
          })
      )
      expect(result.rows.map((row) => row.id).sort()).toEqual(
        [fixture.table.rows.clean, fixture.table.rows.entries].sort()
      )
      expect(result.secretProvenance?.complete).toBe(true)
      const receiver = new ResolvedSecretTraceRegistry([], scope)
      expect(
        await receiver.importProvenance(result.secretProvenance, {
          trusted: true,
          origin: 'delivered-table-page',
        })
      ).toBe(true)
      const projected = projectResolvedSecretModelContent(
        result.rows.map((row) => row.data),
        receiver
      )
      expect(projected.safe).toBe(true)
      expect(JSON.stringify(projected)).not.toContain(CANARY.secret)
      expect(JSON.stringify(projected)).toContain('{{FIXTURE_TOKEN}}')
      const ordinary = await queryTableRows.execute({
        principal: createSessionPrincipal({ userId: scope.userId }),
        input: { tableId: fixture.table.tableId, includePersistedSecretProvenance: true },
      })
      expect(ordinary.rows).toHaveLength(3)
      expect(ordinary.secretProvenance?.complete).toBe(false)
    })

    it('filters and sorts mixed-provenance rows without refusing unrelated content (#18b)', async () => {
      const table = `/api/v2/tables/${fixture.table.tableId}`
      const predicate = { field: 'note', op: 'contains', value: 'second' }
      const query = await cli('POST', `${table}/query`, {
        workspaceId: ws(),
        predicate,
        sort: [{ field: 'note', direction: 'asc' }],
      })
      expectPerItem(query, { secretAdmitted: true })
      const count = await cli('POST', `${table}/query/count`, { workspaceId: ws(), predicate })
      expect(count.status).toBe(200)
      expect(count.body).not.toContain(CANARY.secret)
      expect(count.body).not.toContain(CANARY.unknown)
    })

    it('returns search locations without copying cell values or refusing a mixed table', async () => {
      const search = await cli('POST', `/api/v2/tables/${fixture.table.tableId}/rows/search`, {
        workspaceId: ws(),
        q: 'second',
      })
      expect(search.status).toBe(200)
      const matches: { rowId: string; column: string; ordinal: number }[] = JSON.parse(search.body)
        .data.matches
      expect(matches.map((match) => match.rowId).sort()).toEqual(
        Object.values(fixture.table.rows).sort()
      )
      expect(search.body).not.toContain(CANARY.secret)
      expect(search.body).not.toContain(CANARY.unknown)
    })

    it.each(['PATCH', 'DELETE'])(
      'allows a filtered %s beside an unrelated unknown row',
      async (method) => {
        const table = `/api/v2/tables/${fixture.table.tableId}`
        const marker = `temporary-${generateId()}`
        const created = await cli('POST', `${table}/rows`, {
          workspaceId: ws(),
          data: { note: marker },
        })
        expect(created.status).toBe(201)
        const rowId: string = JSON.parse(created.body).data.id
        const written = await cli(method, `${table}/rows`, {
          workspaceId: ws(),
          filter: { field: 'note', op: 'eq', value: marker },
          ...(method === 'PATCH' ? { data: { note: `${marker}-updated` } } : {}),
        })
        expect(written.status).toBe(200)
        expect(JSON.parse(written.body).data).toMatchObject(
          method === 'PATCH' ? { updatedCount: 1 } : { deletedCount: 1 }
        )
        const read = await cli('GET', `${table}/rows/${rowId}?workspaceId=${ws()}`)
        expect(read.status).toBe(method === 'PATCH' ? 200 : 404)
        if (method === 'PATCH') expect(modelView(read)).toContain(`${marker}-updated`)
      }
    )

    it('keeps clean matches usable when another row has corrupt provenance', async () => {
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
      expect(afterCorruption.status).toBe(200)
      expect(modelView(afterCorruption)).toContain('alpha second')
      const refused = await cli(
        'GET',
        `${table}/rows/${JSON.parse(malformed.body).data.id}?workspaceId=${ws()}`
      )
      expect(refused.status).toBe(403)
      expect(refused.body).not.toContain('gamma')
    })

    it.each(['clean', 'entries'] as const)(
      'applies the archive declared-size budget after %s contributor admission',
      async (kind) => {
        const input = await getWorkspaceFile(ws(), fixture.files[kind], { throwOnError: true })
        if (!input) throw new Error('Missing archive contributor fixture')
        const source = `await getFileBase64('${input.id}'); pdf.addPage().drawText('fixture render');`
        const documentIds: string[] = []
        for (let index = 0; index < (kind === 'clean' ? 6 : 5); index += 1) {
          const doc = await uploadWorkspaceFile(
            ws(),
            fixture.ids.aliceId,
            Buffer.from(
              index === 5 ? 'throw new Error("archive budget checked too late")' : source
            ),
            `archive-budget-${generateId()}.pdf`,
            'text/x-python-pdf',
            {
              notifyWorkspaceChange: false,
              secretProvenance: { status: 'exact', entries: [] },
            }
          )
          // Declared source sizes exercise aggregate accounting without large fixture allocations.
          await db
            .update(workspaceFiles)
            .set({ sizeBytes: 50 * 1024 * 1024 })
            .where(eq(workspaceFiles.id, doc.id))
          documentIds.push(doc.id)
        }
        const result = await cli(
          'GET',
          `/api/v2/files/bulk-download?workspaceId=${ws()}&fileIds=${fixture.files.clean},${documentIds}`
        )
        if (kind === 'clean') {
          expect(result.status, result.body).toBe(400)
          expect(result.body).toMatch(/download limit/i)
        } else {
          expect(result.status, result.body).toBe(200)
          expect(result.body).toContain(CANARY.clean)
          expect(result.body).toContain('sim-download-report.json')
          for (const id of documentIds) expect(result.body).toContain(id)
          expect(result.body).not.toContain('%PDF-1.7')
        }
      }
    )

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
    it.each([
      'clean',
      'unrecorded',
      'secret',
      'unknown',
      'old-secret',
      'malformed',
      'invalid',
      'mislabeled',
      'uploaded',
      'legacy',
    ] as const)(
      'checks the published document inputs before exposing a share (%s)',
      async (kind) => {
        const entries = [
          {
            name: 'COMPILED_INPUT',
            encryptedValue: (await encryptSecret(CANARY.secret)).encrypted,
            sourceUserId: fixture.ids.aliceId,
            sourceWorkspaceId: ws(),
          },
        ]
        const inputContent = kind === 'clean' ? CANARY.clean : CANARY.secret
        const input = await uploadWorkspaceFile(
          ws(),
          fixture.ids.aliceId,
          Buffer.from(inputContent),
          `compiled-input-${generateId()}.txt`,
          'text/plain',
          {
            notifyWorkspaceChange: false,
            secretProvenance:
              kind === 'unknown'
                ? { status: 'unknown' }
                : kind === 'unrecorded'
                  ? { status: 'unrecorded' }
                  : { status: 'exact', entries: kind === 'clean' ? [] : entries },
          }
        )
        const record = await getWorkspaceFile(ws(), input.id, { throwOnError: true })
        if (!record) throw new Error('Missing compiled input fixture')
        const source =
          kind === 'uploaded'
            ? '%PDF-1.7\nordinary uploaded binary'
            : `data = open(input_path("${input.id}"), "rb").read()`
        const document = await uploadWorkspaceFile(
          ws(),
          fixture.ids.aliceId,
          Buffer.from(source),
          `compiled-share-${generateId()}.pdf`,
          kind === 'mislabeled' || kind === 'uploaded' ? 'application/pdf' : 'text/x-python-pdf',
          { notifyWorkspaceChange: false, secretProvenance: { status: 'exact', entries: [] } }
        )
        const identity = JSON.stringify({
          version: 1,
          inputs: [
            {
              fileId: input.id,
              key: record.key,
              context: record.storageContext ?? 'workspace',
              contentVersion: (record.contentUpdatedAt ?? record.updatedAt).toISOString(),
              size: record.size,
            },
          ],
        })
        const artifact = Buffer.from(`%PDF-1.7\n${inputContent}`)
        await storeCompiledDoc(
          ws(),
          source,
          'pdf',
          'application/pdf',
          artifact,
          kind === 'legacy'
            ? undefined
            : kind === 'malformed'
              ? '{invalid'
              : kind === 'invalid'
                ? JSON.stringify({ version: 1, inputs: [{}] })
                : identity
        )
        const published = await resolveServableDoc(ws(), Buffer.from(source), document.name)
        expect(published.kind).toBe(kind === 'uploaded' ? 'passthrough' : 'artifact')
        if (published.kind === 'artifact') expect(published.buffer).toEqual(artifact)
        if (kind === 'old-secret') {
          await replaceFixtureFileContent(
            ws(),
            input.id,
            fixture.ids.aliceId,
            Buffer.from('now clean'),
            undefined,
            {
              version: { source: 'api', authorUserId: fixture.ids.aliceId },
              secretProvenancePolicy: {
                mode: 'replace',
                provenance: { status: 'exact', entries: [] },
              },
            }
          )
        }
        const allowed = ['clean', 'unrecorded', 'legacy', 'uploaded'].includes(kind)
        const invalid = kind === 'malformed' || kind === 'invalid'
        const activation = await cli('PATCH', `/api/v2/files/${document.id}/share`, {
          workspaceId: ws(),
          isActive: true,
          authType: 'public',
        })
        expect.soft(activation.status).toBe(allowed ? 200 : invalid ? 500 : 403)
        if (!allowed) expect.soft(await getShareForResource('file', document.id)).toBeNull()

        const humanShare = await updateWorkspaceFileShare.execute({
          principal: createSessionPrincipal({ userId: fixture.ids.aliceId }),
          input: { fileId: document.id, isActive: true, authType: 'public' },
        })
        expect(humanShare.share.isActive).toBe(true)
        for (const read of [cli, sandbox]) {
          const link = await read('GET', `/api/v2/files/${document.id}/share?workspaceId=${ws()}`)
          expect.soft(link.status).toBe(allowed ? 200 : invalid ? 500 : 403)
          if (!allowed) expect.soft(link.body).not.toContain(humanShare.share.token)
        }
        if (!invalid) {
          const result = await observeContentDelivery(
            createRegistryContentGate({
              registry: new ResolvedSecretTraceRegistry([]),
              actorUserId: fixture.ids.aliceId,
              workspaceId: ws(),
            }),
            () =>
              getWorkspaceFileShares.execute({
                principal: createCopilotChatPrincipal(
                  { userId: fixture.ids.aliceId, workspaceId: ws() },
                  WORKSPACE_FILES_DELEGATION_AUDIENCE
                ),
                input: { workspaceId: ws(), fileIds: [document.id, fixture.files.clean] },
              })
          )
          expect(result.shares.has(document.id)).toBe(allowed)
          expect(result.shares.has(fixture.files.clean)).toBe(true)
        }
      }
    )

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

  it.each(['test', 'changelog'] as const)(
    'reads an owned %s body using its canonical provenance identity',
    async (context) => {
      featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(true)
      const content = 'owned file source for an authorized read'
      const ownerId = generateId()
      const created = await createOwnedWorkspaceFile({
        context,
        workspaceId: ws(),
        userId: fixture.ids.aliceId,
        content,
        contentType: 'text/plain',
        fileName: (fileId) => `${fileId}.txt`,
        insertOwner: async (tx, bodyFileId) => {
          if (context === 'test') {
            await tx.insert(workflowTest).values({
              id: ownerId,
              workspaceId: ws(),
              name: ownerId,
              title: 'Owned test fixture',
              bodyFileId,
              sourceHash: sha256Hex(content),
            })
          } else {
            await tx.insert(changelogRelease).values({
              id: ownerId,
              workspaceId: ws(),
              title: 'Owned release fixture',
              versionMajor: 1,
              versionMinor: 0,
              versionPatch: 0,
              bumpReason: 'fixture',
              bodyFileId,
            })
          }
        },
      })
      const principal = createCopilotChatPrincipal(
        { userId: fixture.ids.aliceId, workspaceId: ws() },
        WORKSPACE_FILES_DELEGATION_AUDIENCE
      )
      const registry = new ResolvedSecretTraceRegistry([], {
        userId: fixture.ids.aliceId,
        workspaceId: ws(),
      })
      const gate = createRegistryContentGate({
        registry,
        actorUserId: fixture.ids.aliceId,
        workspaceId: ws(),
      })
      const result = await observeContentDelivery(gate, () =>
        readWorkspaceFileContent.execute({
          principal,
          input: { fileId: created.fileId, includeSecretProvenance: true },
        })
      )
      expect(result.content.toString()).toBe(content)
      expect(result.file.vfsNamespace).toBe(context === 'test' ? 'tests' : 'changelog')
      expect(result.secretProvenance).toEqual({ status: 'exact', entries: [] })
      const evidence = await observeContentDelivery(gate, () =>
        readWorkspaceFileSecretProvenance.execute({
          principal,
          input: { fileId: created.fileId },
        })
      )
      expect.soft(evidence.provenance).toEqual({ status: 'exact', entries: [] })
      const staleEvidence = await observeContentDelivery(gate, () =>
        readWorkspaceFileSecretProvenance.execute({
          principal,
          input: { fileId: created.fileId, expectedContentUpdatedAt: new Date(0) },
        })
      )
      expect(staleEvidence.provenance).toEqual({ status: 'unknown' })
      if (context === 'changelog') {
        const version = await cli(
          'GET',
          `/api/v2/files/${created.fileId}/versions/1/text?workspaceId=${ws()}`
        )
        expect.soft(version.status).toBe(200)
        expect.soft(modelView(version)).toContain(content)
      }
      featureFlagsMockFns.mockIsFeatureEnabled.mockReset()
    }
  )

  describe.each([
    ['image', generateImageServerTool],
    ['audio', generateAudioServerTool],
    ['video', generateVideoServerTool],
  ] as const)('%s reference delivery', (_kind, tool) => {
    it.each(['clean', 'unrecorded', 'entries', 'unknown', 'changed'] as const)(
      'classifies the bytes actually read for a %s reference before provider delivery',
      async (classification) => {
        mediaProvider.calls.length = 0
        const exact: WorkspaceFileSecretProvenance = {
          status: 'exact',
          entries: [
            {
              encryptedValue: (await encryptSecret(CANARY.secret)).encrypted,
              sourceUserId: fixture.ids.aliceId,
              sourceWorkspaceId: ws(),
              name: 'MEDIA_REFERENCE_TOKEN',
            },
          ],
        }
        const provenance: WorkspaceFileSecretProvenance =
          classification === 'entries'
            ? exact
            : classification === 'unknown'
              ? { status: 'unknown' }
              : classification === 'unrecorded'
                ? { status: 'unrecorded' }
                : { status: 'exact', entries: [] }
        const bytes = Buffer.from(
          classification === 'entries' ? CANARY.secret : 'ordinary reference bytes'
        )
        const file = await uploadWorkspaceFile(
          ws(),
          fixture.ids.aliceId,
          bytes,
          `media-reference-${generateId()}.png`,
          'image/png',
          { secretProvenance: provenance, notifyWorkspaceChange: false }
        )
        const originalRead = readWorkspaceFileContent.execute.bind(readWorkspaceFileContent)
        const interleave =
          classification === 'changed'
            ? vi.spyOn(readWorkspaceFileContent, 'execute').mockImplementationOnce(async (args) => {
                await replaceFixtureFileContent(
                  ws(),
                  file.id,
                  fixture.ids.aliceId,
                  Buffer.from(CANARY.secret),
                  undefined,
                  {
                    version: { source: 'api', authorUserId: fixture.ids.aliceId },
                    secretProvenancePolicy: { mode: 'replace', provenance: exact },
                  }
                )
                return originalRead(args)
              })
            : undefined
        const registry = new ResolvedSecretTraceRegistry([], {
          userId: fixture.ids.aliceId,
          workspaceId: ws(),
        })
        try {
          const result = await observeContentDelivery(
            createRegistryContentGate({
              registry,
              actorUserId: fixture.ids.aliceId,
              workspaceId: ws(),
            }),
            () =>
              tool.execute(
                {
                  prompt: 'ordinary request',
                  inputs: { files: [{ path: `files/${file.name}` }] },
                },
                {
                  userId: fixture.ids.aliceId,
                  workspaceId: ws(),
                  toolCallId: generateId(),
                  copilotToolExecution: true,
                  resolvedSecretTraceRegistry: registry,
                }
              )
          )
          const allowed = classification === 'clean' || classification === 'unrecorded'
          expect(result.success).toBe(false)
          expect(result.message).toContain(
            allowed ? 'fixture media provider reached' : 'cannot be sent'
          )
          expect(mediaProvider.calls).toHaveLength(allowed ? 1 : 0)
          if (allowed)
            expect(JSON.stringify(mediaProvider.calls)).toContain(bytes.toString('base64'))
          expect(registry.isPermanentlyIncomplete()).toBe(false)
        } finally {
          interleave?.mockRestore()
        }
      }
    )
  })

  describe.each(['cli', 'sandbox'] as const)('%s text excerpts', (surface) => {
    const read = (route: string) => (surface === 'cli' ? cli('GET', route) : sandbox('GET', route))

    it('preserves indexed match locations without releasing a clipped secret prefix', async () => {
      const query = `preview-cut-${generateId()}`
      const provenance: WorkspaceFileSecretProvenance = {
        status: 'exact',
        entries: [
          {
            encryptedValue: (await encryptSecret(CANARY.secret)).encrypted,
            sourceUserId: fixture.ids.aliceId,
            sourceWorkspaceId: ws(),
            name: 'FIXTURE_TOKEN',
          },
        ],
      }
      const sources = [
        {
          name: 'protected',
          content: `${`${query} `.padEnd(500, '.')}${CANARY.secret} after the token`,
          provenance,
        },
        {
          name: 'clean',
          content: `${query} clean preview`,
          provenance: { status: 'exact', entries: [] } as const,
        },
        {
          name: 'unrecorded',
          content: `${query} ordinary uploaded preview`,
          provenance: { status: 'unrecorded' } as const,
        },
      ]
      const fileIds: string[] = []
      for (const source of sources) {
        const file = await uploadWorkspaceFile(
          ws(),
          fixture.ids.aliceId,
          Buffer.from(source.content),
          `${source.name}-${generateId()}.txt`,
          'text/plain',
          { secretProvenance: source.provenance, notifyWorkspaceChange: false }
        )
        fileIds.push(file.id)
        const sourceContentUpdatedAt = file.contentUpdatedAt ?? new Date()
        const dispatchedAt = new Date()
        await db
          .insert(workspaceFileSearchRevision)
          .values({
            fileId: file.id,
            workspaceId: ws(),
            sourceContentUpdatedAt,
            status: 'pending',
            dispatchedAt,
          })
          .onConflictDoUpdate({
            target: workspaceFileSearchRevision.fileId,
            set: { status: 'pending', dispatchedAt, sourceContentUpdatedAt, buildId: null },
          })
        await indexWorkspaceFileForSearch(
          {
            workspaceId: ws(),
            fileId: file.id,
            sourceContentUpdatedAt: sourceContentUpdatedAt.toISOString(),
            dispatchToken: dispatchedAt.toISOString(),
          },
          new AbortController().signal
        )
      }
      const route = `/api/v2/files/search?workspaceId=${ws()}&query=${encodeURIComponent(query)}&maxResults=3`
      const userRead = await callV2(fixture, 'GET', route)
      expect(userRead.status).toBe(200)
      const userResults: Array<{ fileId: string; text: string }> = (await userRead.json()).data
        .results
      const protectedPreview = userResults.find((result) => result.fileId === fileIds[0])?.text
      expect(protectedPreview).toContain(CANARY.secret.slice(0, 12))
      expect(protectedPreview).not.toContain(CANARY.secret)

      const result = await read(route)
      expect(result.status).toBe(200)
      const data: {
        results: Array<{ fileId: string; lineNumber: number; text: string }>
        count: number
        truncated: boolean
      } = JSON.parse(result.body).data
      expect(data.count).toBe(3)
      expect(data.truncated).toBe(false)
      expect(new Set(data.results.map((entry) => entry.fileId))).toEqual(new Set(fileIds))
      expect(data.results.find((entry) => entry.fileId === fileIds[0])).toMatchObject({
        lineNumber: 1,
        text: expect.stringMatching(/preview withheld/i),
      })
      expect(data.results.find((entry) => entry.fileId === fileIds[1])?.text).toBe(
        sources[1].content
      )
      expect(data.results.find((entry) => entry.fileId === fileIds[2])?.text).toBe(
        sources[2].content
      )
      expect(result.body).not.toContain(CANARY.secret.slice(0, 12))
    })

    it('keeps a one-line read within the file owner’s extraction budget', async () => {
      const file = await uploadWorkspaceFile(
        ws(),
        fixture.ids.aliceId,
        Buffer.from(`small selected line\n${CANARY.secret}\n${'.'.repeat(17 * 1024 * 1024)}`),
        `large-line-window-${generateId()}.txt`,
        'text/plain',
        {
          secretProvenance: {
            status: 'exact',
            entries: [
              {
                encryptedValue: (await encryptSecret(CANARY.secret)).encrypted,
                sourceUserId: fixture.ids.aliceId,
                sourceWorkspaceId: ws(),
                name: 'FIXTURE_TOKEN',
              },
            ],
          },
          notifyWorkspaceChange: false,
        }
      )
      const result = await read(
        `/api/v2/files/${file.id}/text?workspaceId=${ws()}&offset=1&limit=1`
      )
      expect(result.status).toBe(200)
      expect(JSON.parse(result.body).data.text).toBe('small selected line')
      expect(result.body).not.toContain(CANARY.secret)
    })

    it.each(['\n', '\r\n'])(
      'preserves original line positions while redacting a multiline secret (%j)',
      async (eol) => {
        const secret = `RANGE_TOKEN_FIRST_LINE_64C1${eol}RANGE_TOKEN_SECOND_LINE_97B2`
        const file = await uploadWorkspaceFile(
          ws(),
          fixture.ids.aliceId,
          Buffer.from(`header${eol}${secret}${eol}footer`),
          `line-window-${generateId()}.txt`,
          'text/plain',
          {
            secretProvenance: {
              status: 'exact',
              entries: [
                {
                  encryptedValue: (await encryptSecret(secret)).encrypted,
                  sourceUserId: fixture.ids.aliceId,
                  sourceWorkspaceId: ws(),
                  name: 'RANGE_TOKEN',
                },
              ],
            },
            notifyWorkspaceChange: false,
          }
        )
        const result = await read(
          `/api/v2/files/${file.id}/text?workspaceId=${ws()}&offset=2&limit=1`
        )
        expect(result.status).toBe(200)
        expect(JSON.parse(result.body).data.text).toBe('{{RANGE_TOKEN}}')
        expect(JSON.parse(result.body).data.lineRange).toEqual({
          offset: 2,
          lineCount: 1,
          totalLines: 4,
          totalLinesExact: true,
        })
        for (const [offset, expected] of [
          [3, '{{RANGE_TOKEN}}'],
          [4, 'footer'],
        ] as const) {
          const selected = await read(
            `/api/v2/files/${file.id}/text?workspaceId=${ws()}&offset=${offset}&limit=1`
          )
          expect(selected.status).toBe(200)
          expect(JSON.parse(selected.body).data).toMatchObject({
            text: expected,
            lineRange: { offset, lineCount: 1, totalLines: 4, totalLinesExact: true },
          })
        }
        if (surface === 'cli') {
          const registry = new ResolvedSecretTraceRegistry([], {
            userId: fixture.ids.aliceId,
            workspaceId: ws(),
          })
          const privateRead = await observeContentDelivery(
            createRegistryContentGate({
              registry,
              actorUserId: fixture.ids.aliceId,
              workspaceId: ws(),
            }),
            async () => {
              const original = await readWorkspaceFileContent.execute({
                principal: createCopilotChatPrincipal(
                  { userId: fixture.ids.aliceId, workspaceId: ws() },
                  WORKSPACE_FILES_DELEGATION_AUDIENCE
                ),
                input: { fileId: file.id },
              })
              return observePrivateFile(
                {
                  buffer: original.content,
                  name: original.file.name,
                  path: original.file.path,
                  source: 'upload',
                },
                {},
                { offset: 3, limit: 2 }
              )
            }
          )
          expect(privateRead.exitCode).toBe(0)
          expect(JSON.parse(privateRead.stdout)).toMatchObject({
            text: `{{RANGE_TOKEN}}${eol}footer`,
            lineRange: { offset: 3, lineCount: 2, totalLines: 4, totalLinesExact: true },
          })
        }
        expect(result.body).not.toContain('RANGE_TOKEN_FIRST_LINE_64C1')
        expect(result.body).not.toContain('RANGE_TOKEN_SECOND_LINE_97B2')
        if ('sessionKey' in result) {
          expect(await workbenchHistory(result.sessionKey)).toMatchObject({
            status: 'exact',
            entries: [expect.objectContaining({ name: 'RANGE_TOKEN' })],
          })
        }
      }
    )
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
      expect(zip.body).toContain(CANARY.secret)
      expect(await workbenchHistory(zip.sessionKey)).toMatchObject({
        status: 'exact',
        entries: [expect.objectContaining({ name: 'FIXTURE_TOKEN' })],
      })
      expect(zip.body).not.toContain(CANARY.unknown)
      expect(zip.body).toContain('sim-download-report.json')
      expect(zip.body).toContain(fixture.files.unknown)

      const search = await sandbox(
        'GET',
        `/api/v2/files/search?workspaceId=${ws()}&query=${encodeURIComponent('PROVENANCE')}`
      )
      expect(search.status).toBe(200)
      expect(search.body).toContain(fixture.files.unknown)
      expect(search.body).toMatch(/preview withheld/i)
      expect(search.body).not.toContain(CANARY.unknown)
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
      expect(write.body).toContain('The change was saved')
      expect(write.body).toContain('Do not retry the change')
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
