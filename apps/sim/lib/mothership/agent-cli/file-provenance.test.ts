import { Readable } from 'node:stream'
import { workspaceFiles } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { fileParsersMock, fileParsersMockFns } from '@sim/testing/mocks/file-parsers.mock'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import {
  mothershipWorkspaceTargetMock,
  mothershipWorkspaceTargetMockFns,
} from '@sim/testing/mocks/mothership-workspace-target.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { v2ApiKeyAuthModuleMock, v2RouteMocks } from '@sim/testing/mocks/v2-route.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from '@sim/testing/mocks/workspace-file-manager.mock'
import { workspaceUploadsMock } from '@sim/testing/mocks/workspace-uploads.mock'
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  render: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/uploads/contexts/workspace/file-manager', () => workspaceFileManagerMock)
vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)
vi.mock('@/lib/file-parsers', () => fileParsersMock)
vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
vi.mock('@/lib/workspace-files/application/resolve-rendered-workspace-artifact', () => ({
  resolveRenderedWorkspaceArtifact: hoisted.render,
}))
vi.mock('@/lib/execution/remote-sandbox/session-files', () => ({
  SESSION_SANDBOX_HOME: '/home/user',
  readSessionSandboxFile: vi.fn(),
  writeSessionSandboxFile: vi.fn(),
}))
vi.mock('@/lib/execution/remote-sandbox/session-file-snapshot', () => ({
  openSessionFileSnapshot: vi.fn(),
}))
vi.mock('@/lib/mothership/chat/delegation', () => ({ mintDelegationToken: async () => 'fixture' }))

import {
  admitContent,
  type ContentSource,
  noteContentDeliveryOperation,
  observeContentDelivery,
} from '@/lib/core/application'
import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import { OrchestrationError } from '@/lib/core/orchestration/types'

vi.mock('@/lib/mothership/application/workspace-target', () => mothershipWorkspaceTargetMock)
vi.mock('@/lib/mothership/agent-cli/scoped-transport', () => ({
  createScopedCliTransport: () => globalThis.fetch,
}))

import { createFileReadTransport } from '@/lib/mothership/agent-cli/file-read-transport'
import { createAgentCliTransport } from '@/lib/mothership/agent-cli/transport'
import { createWorkbenchFileProvenance } from '@/lib/mothership/agent-cli/workbench-file-provenance'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'
import { createRegistryContentGate } from '@/lib/mothership/content-delivery'
import { inspectToolResultForCopilot } from '@/lib/mothership/request/tools/resolved-secret-result'
import { executeSimCli } from '@/lib/mothership/tools/handlers/sim-cli'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { readWorkspaceFileArtifact } from '@/lib/workspace-files/application/read-workspace-file-artifact'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const mocks = {
  ...hoisted,
  file: workspaceFileManagerMockFns.mockGetWorkspaceFile,
  context: workspaceFileManagerMockFns.mockLoadActiveWorkspaceFileContext,
  reference: workspaceFileManagerMockFns.mockResolveWorkspaceFileReference,
  stream: storageServiceMockFns.mockDownloadFileStream,
  permission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  buffer: workspaceFileManagerMockFns.mockFetchWorkspaceFileBuffer,
  decrypt: encryptionMockFns.mockDecryptSecret,
}
workspaceFileManagerMockFns.mockWorkspaceFileVfsPath.mockReturnValue('files/private.txt')
fileParsersMockFns.mockIsSupportedFileType.mockReturnValue(true)
fileParsersMockFns.mockParseBuffer.mockImplementation(async (buffer: Buffer) => ({
  content: buffer.toString(),
  metadata: {},
}))
// Chat-target admission is covered by workspace-target.test; retain real file authorization below.
mothershipWorkspaceTargetMockFns.mockResolveInvocationWorkspace.mockImplementation(
  async (owner: { userId: string }, workspaceId?: string) => ({
    workspaceId: workspaceId ?? 'workspace',
    userId: owner.userId,
  })
)

const principal = createPersonalApiKeyPrincipal({ userId: 'reader', keyId: 'fixture-key' })
const CHAT = createCopilotChatPrincipal(
  { userId: 'reader', workspaceId: 'workspace', chatId: 'chat' },
  WORKSPACE_FILES_DELEGATION_AUDIENCE
)

function fileSource(id: string, provenance: ContentSource['provenance']): ContentSource {
  return { kind: 'workspace-file', id, provenance, view: 'opaque' }
}
const content = 'PRIVATE_FILE_CANARY_FOR_LOCAL_TEST'
const revision = new Date('2026-09-06T00:00:00Z')
const file = {
  id: 'file',
  workspaceId: 'workspace',
  key: 'workspace/workspace/canonical-key',
  name: 'private.txt',
  type: 'text/plain',
  size: Buffer.byteLength(content),
  storageContext: 'workspace',
  contentUpdatedAt: revision,
}

function registry() {
  return new ResolvedSecretTraceRegistry([], { userId: 'reader', workspaceId: 'workspace' })
}

function classify(
  status: 'exact' | 'unknown',
  fileRevision = revision,
  entries: Extract<WorkspaceFileSecretProvenance, { status: 'exact' }>['entries'] = [],
  includePublicationRows = true
) {
  resetDbChainMock()
  const sidecar = {
    id: file.id,
    key: file.key,
    context: file.storageContext,
    fileContentUpdatedAt: fileRevision,
    secretProvenanceVersion: 1,
    provenanceContentUpdatedAt: fileRevision,
    status,
    entries,
  }
  queueTableRows(workspaceFiles, [sidecar])
  if (!includePublicationRows) return
  queueTableRows(workspaceFiles, [
    { ...file, context: file.storageContext, secretProvenanceVersion: 1 },
  ])
  queueTableRows(workspaceFiles, [sidecar])
}

type SidecarStatus = 'exact' | 'unknown'

function sidecarRow(status: SidecarStatus, fileRevision = revision, entries: unknown[] = []) {
  return {
    fileContentUpdatedAt: fileRevision,
    secretProvenanceVersion: 1,
    provenanceContentUpdatedAt: fileRevision,
    status,
    entries,
  }
}

/** Queues one sidecar per status, in the order the reads consume them. */
function classifySequence(...statuses: [SidecarStatus, ...SidecarStatus[]]) {
  resetDbChainMock()
  for (const status of statuses) queueTableRows(workspaceFiles, [sidecarRow(status)])
}

type CliInvocation = Parameters<typeof executeSimCli>[0]['request']['invocation']

const readFile: CliInvocation = {
  kind: 'augmentation',
  name: 'files read',
  positionals: ['file'],
  flags: {},
}

function grepFiles(pattern: string): CliInvocation {
  return { kind: 'augmentation', name: 'grep', positionals: [pattern], flags: { scope: 'files' } }
}

/**
 * The CLI handler as the tool executor runs it: under the gate bound to the call's registry, which
 * augmentation engines that call use cases in-process rely on.
 */
function simCli(...[params, context]: Parameters<typeof executeSimCli>) {
  const gate = createRegistryContentGate({
    registry: context.resolvedSecretTraceRegistry,
    workspaceId: context.workspaceId,
    actorUserId: context.userId,
  })
  return observeContentDelivery(gate, () => executeSimCli(params, context))
}

function runCli(invocation: CliInvocation, trace = registry()) {
  return simCli(
    { request: { invocation } },
    {
      userId: 'reader',
      workspaceId: 'workspace',
      workflowId: '',
      chatId: 'chat',
      resolvedSecretTraceRegistry: trace,
    }
  )
}

const invocation = { userId: 'reader', workspaceId: 'workspace', chatId: 'chat' }

/** Chat's CLI transport as every invocation composes it: the registry gate around the routes. */
function readTransport(trace = registry(), tracked = true): typeof fetch {
  const transport = createAgentCliTransport({
    endpoint: 'https://sim.test',
    invocation,
    registry: trace,
    files: tracked
      ? createWorkbenchFileProvenance({
          userId: 'reader',
          workspaceId: 'workspace',
          sessionKey: 'chat',
          resolvedSecretTraceRegistry: trace,
        })
      : undefined,
    resources: [],
    observeReads: true,
  })
  return (input, init) =>
    withWorkspaceInvocationScope({ workspaceId: 'workspace' }, () => transport(input, init))
}

function fileRequest(suffix = '', signal?: AbortSignal) {
  return new Request(`https://sim.test/api/v2/files/file${suffix}?workspaceId=workspace`, {
    headers: { 'x-api-key': 'fixture' },
    signal,
  })
}

describe('file provenance at the actual CLI and model-result boundary', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.permission.mockResolvedValue('read')
    v2RouteMocks.authenticate.mockResolvedValue({ principal })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('Unexpected network request')
      })
    )
    mocks.file.mockResolvedValue(file)
    mocks.reference.mockResolvedValue(file)
    mocks.context.mockResolvedValue({
      workspaceId: 'workspace',
      fileId: 'file',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'owner',
    })
    mocks.stream.mockImplementation(async () => Readable.from(Buffer.from(content)))
    mocks.buffer.mockResolvedValue(Buffer.from(content))
    mocks.decrypt.mockResolvedValue({ decrypted: content })
    classify('unknown')
  })

  it('uses current Copilot file authority with personal keys disabled and rejects a foreign ID-only owner', async () => {
    mocks.context.mockResolvedValue({
      workspaceId: 'workspace',
      fileId: 'file',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: false,
      billedAccountUserId: 'owner',
    })
    classify('exact')
    const transport = readTransport()
    const response = await transport(fileRequest())
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(content)
    expect(v2RouteMocks.authenticate).not.toHaveBeenCalled()
    mocks.context.mockResolvedValue({
      workspaceId: 'foreign',
      fileId: 'file',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: false,
      billedAccountUserId: 'other',
    })
    const denied = await transport(fileRequest())
    expect(denied.status).toBe(404)
    expect(mocks.stream).toHaveBeenCalledTimes(1)
  })

  it('refuses an otherwise authorized visual observation using the stored classification', async () => {
    const gate = createRegistryContentGate({
      registry: registry(),
      workspaceId: 'workspace',
      actorUserId: 'reader',
    })
    await expect(
      withWorkspaceInvocationScope({ workspaceId: 'workspace' }, () =>
        observeContentDelivery(gate, () =>
          readWorkspaceFileArtifact.execute({
            principal: CHAT,
            input: { workspaceId: 'workspace', reference: 'file', maxBytes: 1024 },
          })
        )
      )
    ).rejects.toThrow('File cannot be sent to a model')
    expect(mocks.render).not.toHaveBeenCalled()
    expect(mocks.stream).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'does not expose a refused file when a matching secret is active=%s',
    async (active) => {
      const registry = new ResolvedSecretTraceRegistry(
        [{ name: 'FILE_SECRET', plaintext: content, encryptedValue: 'fixture-encrypted' }],
        { userId: 'reader', workspaceId: 'workspace' }
      )
      if (active) registry.recordResolved('FILE_SECRET', content, { propagated: true })
      const result = await simCli(
        {
          request: {
            invocation: { kind: 'cli', argv: ['files', 'get', 'file'] },
          },
        },
        {
          userId: 'reader',
          workspaceId: 'workspace',
          workflowId: '',
          chatId: 'chat',
          resolvedSecretTraceRegistry: registry,
        }
      )
      expect(result.success).toBe(true)
      expect(JSON.stringify(result.output)).toContain(content)
      expect(mocks.stream).toHaveBeenCalledTimes(1)
      const projection = inspectToolResultForCopilot(result, registry, 'sim_cli')
      expect(JSON.stringify(projection.result)).not.toContain(content)
    }
  )

  it.each(['', '/text'])('keeps safe file contents usable through %s', async (suffix) => {
    classify('exact')
    const trace = registry()
    const response = await readTransport(trace)(fileRequest(suffix))
    expect(response.status).toBe(200)
    const output = await response.text()
    expect(output).toContain(content)
    expect(output).not.toContain('secretProvenance')
    const projection = inspectToolResultForCopilot({ success: true, output }, trace, 'sim_cli')
    expect(JSON.stringify(projection.result)).toContain(content)
    expect(trace.isPermanentlyIncomplete()).toBe(false)
    /** Chat reads as its invocation's delegation, never as the credential a request carries. */
    expect(v2RouteMocks.authenticate).not.toHaveBeenCalled()
  })

  it('keeps exact-empty file contents readable through the actual CLI handler', async () => {
    classify('exact')
    const trace = registry()
    const result = await simCli(
      {
        request: {
          invocation: { kind: 'cli', argv: ['files', 'get', 'file'] },
        },
      },
      {
        userId: 'reader',
        workspaceId: 'workspace',
        workflowId: '',
        chatId: 'chat',
        resolvedSecretTraceRegistry: trace,
      }
    )
    expect(result.success).toBe(true)
    expect(JSON.stringify(inspectToolResultForCopilot(result, trace, 'sim_cli').result)).toContain(
      content
    )
    expect(mocks.stream).toHaveBeenCalledTimes(1)
  })

  it('refuses only the unknown item of a forwarded response, naming it, without blanking the invocation', async () => {
    const refusals = getMockLogger('DurableSecretProvenancePersistence').warn
    refusals.mockClear()
    const clean = fileSource('clean', { status: 'exact', entries: [] })
    const tainted = fileSource('tainted', { status: 'unknown' })
    let verdicts: boolean[] = []
    vi.stubGlobal('fetch', async () => {
      const admission = await admitContent(CHAT, [clean, tainted])
      verdicts = [admission.admits(clean), admission.admits(tainted)]
      return new Response('clean item')
    })
    const trace = registry()
    const response = await readTransport(trace)(
      'https://sim.test/api/v2/files/bulk-download?workspaceId=workspace'
    )
    expect(response.status).toBe(200)
    expect(verdicts).toEqual([true, false])
    expect(trace.isPermanentlyIncomplete()).toBe(false)
    expect(refusals).toHaveBeenCalledTimes(1)
    expect(refusals).toHaveBeenCalledWith(
      'Refusing unavailable durable secret provenance',
      expect.objectContaining({ resourceId: 'tainted' })
    )
  })

  it('refuses a successful forwarded response its sourced operation never classified', async () => {
    vi.stubGlobal('fetch', async () => {
      noteContentDeliveryOperation(fileOperations.download, CHAT)
      return new Response(content)
    })
    const trace = registry()
    const response = await readTransport(trace)(
      'https://sim.test/api/v2/files/bulk-download?workspaceId=workspace'
    )
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain(content)
    expect(trace.isPermanentlyIncomplete()).toBe(false)
  })

  it('refuses extracted text whose canonical revision changed before loading its bytes', async () => {
    resetDbChainMock()
    queueTableRows(workspaceFiles, [sidecarRow('exact', new Date(revision.getTime() + 1))])
    const trace = registry()
    const response = await readTransport(trace)(fileRequest('/text'))
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain(content)
    expect(mocks.buffer).not.toHaveBeenCalled()
    expect(trace.isPermanentlyIncomplete()).toBe(false)
  })

  it('still withholds a delivered text read once the registry is incomplete for another reason', async () => {
    classify('exact')
    const trace = registry()
    trace.markIncomplete('provenance-capacity-exceeded')
    const response = await readTransport(trace)(fileRequest('/text'))
    expect(response.status).toBe(200)
    const output = await response.text()
    expect(output).toContain(content)
    expect(
      JSON.stringify(
        inspectToolResultForCopilot({ success: true, output }, trace, 'sim_cli').result
      )
    ).not.toContain(content)
  })

  it('refuses opaque protected downloads without workbench provenance tracking', async () => {
    classify('exact', revision, [
      { name: 'FILE_SECRET', encryptedValue: 'fixture-ciphertext', sourceUserId: 'reader' },
    ])
    const response = await readTransport(registry(), false)(fileRequest())
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain(content)
    expect(mocks.stream).not.toHaveBeenCalled()
  })

  it('imports encrypted file provenance into a fresh registry before model projection', async () => {
    classify('exact', revision, [
      { name: 'FILE_SECRET', encryptedValue: 'fixture-ciphertext', sourceUserId: 'reader' },
    ])
    const trace = registry()
    const response = await readTransport(trace)(fileRequest())
    expect(response.status).toBe(200)
    const output = await response.text()
    expect(output).toContain(content)
    expect(trace.isPermanentlyIncomplete()).toBe(false)
    expect(mocks.decrypt).toHaveBeenCalledWith('fixture-ciphertext', { logFailure: false })
    expect(
      JSON.stringify(
        inspectToolResultForCopilot({ success: true, output }, trace, 'sim_cli').result
      )
    ).not.toContain(content)
  })

  it('redacts generated document contents in a download renderer failure', async () => {
    resetDbChainMock()
    queueTableRows(workspaceFiles, [
      {
        fileContentUpdatedAt: revision,
        secretProvenanceVersion: 1,
        provenanceContentUpdatedAt: revision,
        status: 'exact',
        entries: [
          {
            name: 'FILE_SECRET',
            encryptedValue: 'fixture-ciphertext',
            sourceUserId: 'reader',
            sourceWorkspaceId: 'workspace',
          },
        ],
      },
    ])
    mocks.file.mockResolvedValue({ ...file, name: 'private.pdf', type: 'text/x-pdflibjs' })
    mocks.render.mockRejectedValue(
      new OrchestrationError('conflict', `Document could not be generated: ${content}`)
    )
    const trace = registry()
    const response = await readTransport(trace)(fileRequest())
    expect(response.status).toBe(409)
    const output = await response.text()
    expect(output).toContain(content)
    const projected = inspectToolResultForCopilot({ success: false, output }, trace, 'sim_cli')
    expect(JSON.stringify(projected.result)).not.toContain(content)
    expect(JSON.stringify(projected.result)).toContain('{{FILE_SECRET}}')
  })

  it.each(['sequential', 'parallel'])(
    'carries file classification into each %s grep invocation',
    async (mode) => {
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        expect(new URL(request.url).pathname).toBe('/api/v2/files')
        return Response.json({
          data: [{ ...file, updatedAt: revision.toISOString() }],
          nextCursor: null,
        })
      })
      classify('unknown', revision, [], false)
      const grep = async () => {
        const trace = registry()
        const result = await runCli(grepFiles(content), trace)
        expect(result.error).toContain('Search incomplete')
        expect(JSON.stringify(result.output)).toContain(
          'files/private.txt (file): could not read text'
        )
        expect(JSON.stringify(result.output)).toContain('No matches')
        expect(trace.isPermanentlyIncomplete()).toBe(false)
      }
      if (mode === 'parallel') await Promise.all([grep(), grep()])
      else {
        await grep()
        await grep()
      }
      expect(mocks.buffer).not.toHaveBeenCalled()
    }
  )

  it('returns clean grep matches while refusing only the file whose provenance is unknown', async () => {
    const tainted = { ...file, id: 'tainted', key: 'workspace/workspace/tainted-key' }
    const taintedText = 'TAINTED_FILE_CANARY_FOR_LOCAL_TEST'
    const byId = (id: string) => (id === tainted.id ? tainted : file)
    mocks.file.mockImplementation(async (_workspaceId: string, id: string) => byId(id))
    mocks.reference.mockImplementation(async (_workspaceId: string, id: string) => byId(id))
    mocks.context.mockImplementation(async (id: string) => ({
      workspaceId: 'workspace',
      fileId: id,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'owner',
    }))
    mocks.buffer.mockImplementation(async (record: { id: string }) =>
      Buffer.from(record.id === tainted.id ? taintedText : content)
    )
    vi.stubGlobal('fetch', async () =>
      Response.json({
        data: [file, tainted].map((record) => ({ ...record, updatedAt: revision.toISOString() })),
        nextCursor: null,
      })
    )
    classifySequence('exact', 'unknown')
    const refusals = getMockLogger('DurableSecretProvenancePersistence').warn
    refusals.mockClear()
    const trace = registry()
    const result = await runCli(grepFiles('CANARY_FOR_LOCAL_TEST'), trace)
    const projected = JSON.stringify(inspectToolResultForCopilot(result, trace, 'sim_cli').result)
    expect(trace.isPermanentlyIncomplete()).toBe(false)
    expect(projected).not.toContain(taintedText)
    expect(projected).toContain(content)
    expect(mocks.buffer).toHaveBeenCalledTimes(1)
    expect(refusals).toHaveBeenCalledTimes(1)
    expect(refusals).toHaveBeenCalledWith(
      'Refusing unavailable durable secret provenance',
      expect.objectContaining({
        cause: 'workspace-file-provenance-unavailable',
        resourceId: tainted.id,
      })
    )
    /** The model is told the file it cannot see exists, so it does not read the gap as absence. */
    expect(result.output).toMatchObject({
      stderr: expect.stringContaining(
        'Note: 1 file was withheld from this result: its secret provenance is unknown, so reading it again will not return it.'
      ),
    })
  })

  describe('grep reshapes a file line only after redacting it', () => {
    const secret = 'sk_live_P3_FIXTURE_0123456789abcdefghij'
    const otherSecret = 'pk_test_P3_FIXTURE_ZYXWVUTSRQPONMLKJIH'
    const keyBlock = [
      '-----BEGIN FIXTURE KEY-----',
      'MIIBFIXTUREKEYLINEONE0123456789',
      'MIIBFIXTUREKEYLINETWO0123456789',
      '-----END FIXTURE KEY-----',
    ].join('\n')
    const LINE_CHARS = 2_000
    const pad = (from: number, to: number) => 'x'.repeat(to - from)

    /** A secret leaks as soon as its first or last four characters, or one of its lines, cross. */
    function fragments(value: string): string[] {
      return [value.slice(0, 4), value.slice(-4), ...value.split('\n')]
    }

    async function grepSecretFile(text: string, pattern: string) {
      const plaintexts: Record<string, string> = {
        'cipher-file': secret,
        'cipher-other': otherSecret,
        'cipher-key': keyBlock,
      }
      mocks.decrypt.mockImplementation(async (cipher: string) => ({
        decrypted: plaintexts[cipher],
      }))
      mocks.buffer.mockResolvedValue(Buffer.from(text))
      vi.stubGlobal('fetch', async () =>
        Response.json({
          data: [{ ...file, size: Buffer.byteLength(text), updatedAt: revision.toISOString() }],
          nextCursor: null,
        })
      )
      resetDbChainMock()
      queueTableRows(workspaceFiles, [
        sidecarRow('exact', revision, [
          { name: 'FILE_SECRET', encryptedValue: 'cipher-file', sourceUserId: 'reader' },
          { name: 'OTHER_SECRET', encryptedValue: 'cipher-other', sourceUserId: 'reader' },
          { name: 'KEY_BLOCK', encryptedValue: 'cipher-key', sourceUserId: 'reader' },
        ]),
      ])
      const trace = registry()
      const result = await runCli(grepFiles(pattern), trace)
      const projection = inspectToolResultForCopilot(result, trace, 'sim_cli')
      expect(projection.safe).toBe(true)
      return JSON.stringify(projection.result)
    }

    it.each([
      ['straddling the clip', `NEEDLE ${pad(7, LINE_CHARS - 10)}${secret} tail`],
      [
        'whose redaction marker would straddle the clip',
        `NEEDLE ${pad(7, LINE_CHARS - 5)}${secret}`,
      ],
      ['wholly past the clip', `NEEDLE ${pad(7, LINE_CHARS + 50)}${secret} tail`],
      [
        'repeated around the clip with another secret',
        `NEEDLE ${otherSecret} ${pad(48, LINE_CHARS - 12)}${secret}${otherSecret}${secret}`,
      ],
    ])('never returns a fragment of a secret %s', async (_case, line) => {
      const projected = await grepSecretFile(`${line}\nsecond line`, 'NEEDLE')
      expect(projected).toContain('NEEDLE')
      expect(projected).toContain('[line truncated]')
      for (const fragment of [...fragments(secret), ...fragments(otherSecret)]) {
        expect(projected).not.toContain(fragment)
      }
      const withoutMarkers = projected
        .replaceAll('{{FILE_SECRET}}', '')
        .replaceAll('{{OTHER_SECRET}}', '')
        .replaceAll('[REDACTED_SECRET]', '')
      expect(withoutMarkers).not.toContain('{{')
      expect(withoutMarkers).not.toContain('[RED')
    })

    it('never returns one line of a multi-line secret', async () => {
      const projected = await grepSecretFile(
        `config start\n${keyBlock}\nconfig end`,
        'FIXTURE KEY|KEYLINE'
      )
      for (const fragment of fragments(keyBlock)) expect(projected).not.toContain(fragment)
      const footer = await grepSecretFile(`config start\n${keyBlock}\nconfig end`, 'config end')
      expect(footer).toContain(':6: config end')
    })
  })

  it('refuses an unknown file through the actual CLI text read without loading its bytes', async () => {
    classify('unknown')
    const result = await runCli(readFile)
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.output)).not.toContain(content)
    expect(JSON.stringify(result)).toContain('secret provenance is unavailable')
    expect(mocks.buffer).not.toHaveBeenCalled()
  })

  it('carries unified text reads through the actual CLI transport and secret projection', async () => {
    resetDbChainMock()
    queueTableRows(workspaceFiles, [
      sidecarRow('exact', revision, [
        { name: 'FILE_SECRET', encryptedValue: 'fixture-ciphertext', sourceUserId: 'reader' },
      ]),
    ])
    const trace = registry()
    const result = await runCli(readFile, trace)
    expect(result.success).toBe(true)
    expect(JSON.stringify(result.output)).toContain(content)
    expect(JSON.stringify(result.output)).toContain('representation')
    expect(
      JSON.stringify(inspectToolResultForCopilot(result, trace, 'sim_cli').result)
    ).not.toContain(content)
    expect(mocks.buffer).toHaveBeenCalledTimes(1)
  })

  it('returns an authorized safe PNG observation through the real augmentation adapter', async () => {
    classify('exact')
    const image = { ...file, name: 'image.png', type: 'image/png' }
    mocks.reference.mockResolvedValue(image)
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
      .png()
      .toBuffer()
    mocks.render.mockResolvedValue({ buffer: png, contentType: 'image/png' })
    const result = await simCli(
      {
        request: {
          invocation: {
            kind: 'augmentation',
            name: 'files read',
            positionals: ['uploads/image.png'],
            flags: {},
          },
        },
      },
      {
        userId: 'reader',
        workspaceId: 'workspace',
        workflowId: '',
        chatId: 'chat',
        resolvedSecretTraceRegistry: registry(),
      }
    )
    expect(result.success).toBe(true)
    expect(JSON.stringify(result.output)).toContain(png.toString('base64'))
    expect(JSON.stringify(result.output)).toContain('image/png')
    expect(mocks.buffer).not.toHaveBeenCalled()
  })

  it('checks current permission before opening storage', async () => {
    mocks.permission.mockResolvedValue(null)
    const response = await readTransport()(fileRequest())
    expect(response.status).toBe(404)
    expect(mocks.stream).not.toHaveBeenCalled()
    expect(mocks.buffer).not.toHaveBeenCalled()
  })

  it.each([
    'https://sim.test/api/v2/files/folders',
    'https://sim.test/api/v2/files/bulk-download',
    'https://sim.test/api/v2/files/file/metadata',
    'https://other.test/api/v2/files/file',
  ])('leaves unrelated requests to the existing transport: %s', async (url) => {
    const fallback = vi.fn(async () => new Response('fallback'))
    const transport = createFileReadTransport({
      endpoint: 'https://sim.test',
      transport: fallback,
      invocation,
    })
    expect(await (await transport(url)).text()).toBe('fallback')
    expect(fallback).toHaveBeenCalledWith(url, undefined)
    expect(v2RouteMocks.authenticate).not.toHaveBeenCalled()
  })

  it('refuses malformed query input before storage', async () => {
    const response = await readTransport()(
      'https://sim.test/api/v2/files/file?workspaceId=workspace&includeSecretProvenance=true'
    )
    expect(response.status).toBe(400)
    expect(mocks.context).not.toHaveBeenCalled()
  })

  it('does not begin a file lookup after Stop before dispatch', async () => {
    const controller = new AbortController()
    const stopped = new Error('Stopped')
    controller.abort(stopped)
    await expect(readTransport()(fileRequest('', controller.signal))).rejects.toBe(stopped)
    expect(mocks.context).not.toHaveBeenCalled()
  })

  it('closes the storage stream when Stop arrives after response headers', async () => {
    classify('exact')
    const source = new Readable({ read() {} })
    mocks.stream.mockResolvedValue(source)
    const controller = new AbortController()
    const response = await readTransport()(fileRequest('', controller.signal))
    expect(response.status).toBe(200)
    const reading = response.text()
    controller.abort(new Error('Stopped'))
    await expect(reading).rejects.toThrow('Stopped')
    expect(source.destroyed).toBe(true)
  })
})
