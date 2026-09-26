import { Readable } from 'node:stream'
import { workspaceFiles } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { fileParsersMock, fileParsersMockFns } from '@sim/testing/mocks/file-parsers.mock'
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
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => workspaceFileManagerMock)
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

import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'

vi.mock('@/lib/mothership/application/workspace-target', () => mothershipWorkspaceTargetMock)
vi.mock('@/lib/mothership/agent-cli/scoped-transport', () => ({
  createScopedCliTransport: () => globalThis.fetch,
}))

import { createFileReadTransport } from '@/lib/mothership/agent-cli/file-read-transport'
import { inspectToolResultForCopilot } from '@/lib/mothership/request/tools/resolved-secret-result'
import { executeSimCli } from '@/lib/mothership/tools/handlers/sim-cli'
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

function classify(status: 'exact' | 'unknown', fileRevision = revision) {
  resetDbChainMock()
  queueTableRows(workspaceFiles, [
    {
      fileContentUpdatedAt: fileRevision,
      secretProvenanceVersion: 1,
      provenanceContentUpdatedAt: fileRevision,
      status,
      entries: [],
    },
  ])
}

function readTransport(trace = registry()) {
  return createFileReadTransport({
    endpoint: 'https://sim.test',
    userId: 'reader',
    registry: trace,
  })
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
    queueTableRows(workspaceFiles, [
      {
        fileContentUpdatedAt: revision,
        secretProvenanceVersion: 1,
        provenanceContentUpdatedAt: revision,
        status: 'unknown',
        entries: [],
      },
    ])
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
    const transport = createFileReadTransport({
      endpoint: 'https://sim.test',
      userId: 'reader',
      registry: registry(),
      invocation: { userId: 'reader', workspaceId: 'workspace', chatId: 'chat' },
    })
    const response = await withWorkspaceInvocationScope({ workspaceId: 'workspace' }, () =>
      transport(fileRequest())
    )
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
    const denied = await withWorkspaceInvocationScope({ workspaceId: 'workspace' }, () =>
      transport(fileRequest())
    )
    expect(denied.status).toBe(404)
    expect(mocks.stream).toHaveBeenCalledTimes(1)
  })

  it('refuses an otherwise authorized visual observation using the stored classification', async () => {
    await expect(
      readWorkspaceFileArtifact.execute({
        principal,
        input: { workspaceId: 'workspace', reference: 'file', maxBytes: 1024 },
      })
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
      const result = await executeSimCli(
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
    expect(v2RouteMocks.authenticate).toHaveBeenCalledWith({
      apiKey: 'fixture',
      bearer: null,
      malformedOAuthBearer: false,
    })
  })

  it('keeps exact-empty file contents readable through the actual CLI handler', async () => {
    classify('exact')
    const trace = registry()
    const result = await executeSimCli(
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

  it('withholds extracted text whose canonical revision changed', async () => {
    classify('exact', new Date(revision.getTime() + 1))
    const trace = registry()
    const response = await readTransport(trace)(fileRequest('/text'))
    expect(response.status).toBe(200)
    const output = await response.text()
    expect(output).toContain(content)
    expect(trace.isPermanentlyIncomplete()).toBe(true)
    expect(
      JSON.stringify(
        inspectToolResultForCopilot({ success: true, output }, trace, 'sim_cli').result
      )
    ).not.toContain(content)
  })

  it('imports encrypted file provenance into a fresh registry before model projection', async () => {
    resetDbChainMock()
    queueTableRows(workspaceFiles, [
      {
        fileContentUpdatedAt: revision,
        secretProvenanceVersion: 1,
        provenanceContentUpdatedAt: revision,
        status: 'exact',
        entries: [
          { name: 'FILE_SECRET', encryptedValue: 'fixture-ciphertext', sourceUserId: 'reader' },
        ],
      },
    ])
    const trace = registry()
    const response = await readTransport(trace)(fileRequest())
    expect(response.status).toBe(200)
    const output = await response.text()
    expect(output).toContain(content)
    expect(trace.isPermanentlyIncomplete()).toBe(false)
    expect(mocks.decrypt).toHaveBeenCalledWith('fixture-ciphertext')
    expect(
      JSON.stringify(
        inspectToolResultForCopilot({ success: true, output }, trace, 'sim_cli').result
      )
    ).not.toContain(content)
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
      classify('unknown')
      const grep = async () => {
        const trace = registry()
        const result = await executeSimCli(
          {
            request: {
              invocation: {
                kind: 'augmentation',
                name: 'grep',
                positionals: [content],
                flags: { scope: 'files' },
              },
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
        expect(JSON.stringify(result.output)).toContain(content)
        expect(
          JSON.stringify(inspectToolResultForCopilot(result, trace, 'sim_cli').result)
        ).not.toContain(content)
      }
      if (mode === 'parallel') await Promise.all([grep(), grep()])
      else {
        await grep()
        await grep()
      }
      expect(mocks.buffer).toHaveBeenCalledTimes(2)
    }
  )

  it('carries unified text reads through the actual CLI transport and secret projection', async () => {
    classify('unknown')
    const trace = registry()
    const result = await executeSimCli(
      {
        request: {
          invocation: {
            kind: 'augmentation',
            name: 'files read',
            positionals: ['file'],
            flags: {},
          },
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
    const result = await executeSimCli(
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

  it('rejects a credential for a different actor before looking up the file', async () => {
    v2RouteMocks.authenticate.mockResolvedValue({
      principal: { ...principal, userId: 'someone-else' },
    })
    const response = await readTransport()(fileRequest())
    expect(response.status).toBe(401)
    expect(mocks.context).not.toHaveBeenCalled()
    expect(mocks.stream).not.toHaveBeenCalled()
  })

  it.each([
    'https://sim.test/api/v2/files/folders',
    'https://sim.test/api/v2/files/bulk-download',
    'https://sim.test/api/v2/files/file/metadata',
    'https://other.test/api/v2/files/file',
  ])('leaves unrelated requests to the existing transport: %s', async (url) => {
    const fallback = vi.fn(async () => new Response('fallback'))
    vi.stubGlobal('fetch', fallback)
    expect(await (await readTransport()(url)).text()).toBe('fallback')
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

  it('does not begin a file lookup after Stop during authentication', async () => {
    const controller = new AbortController()
    const stopped = new Error('Stopped')
    v2RouteMocks.authenticate.mockImplementation(async () => {
      controller.abort(stopped)
      return { principal }
    })
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
