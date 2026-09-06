/** @vitest-environment node */
import { Readable } from 'node:stream'
import { workspaceFiles } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  file: vi.fn(),
  context: vi.fn(),
  reference: vi.fn(),
  stream: vi.fn(),
  render: vi.fn(),
  permission: vi.fn(),
  authenticate: vi.fn(),
  buffer: vi.fn(),
  decrypt: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null) => permission === 'read',
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFile: mocks.file,
  loadActiveWorkspaceFileContext: mocks.context,
  resolveWorkspaceFileReference: mocks.reference,
  workspaceFileVfsPath: () => 'files/private.txt',
}))
vi.mock('@/lib/uploads/contexts/workspace', () => ({ fetchWorkspaceFileBuffer: mocks.buffer }))
vi.mock('@/lib/file-parsers', () => ({
  isSupportedFileType: () => true,
  parseBuffer: async (buffer: Buffer) => ({ content: buffer.toString(), metadata: {} }),
}))
vi.mock('@/lib/core/security/encryption', () => ({ decryptSecret: mocks.decrypt }))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: class extends Error {},
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({ downloadFileStream: mocks.stream }))
vi.mock('@/lib/workspace-files/application/resolve-rendered-workspace-artifact', () => ({
  resolveRenderedWorkspaceArtifact: mocks.render,
}))
vi.mock('@/lib/execution/remote-sandbox/session-files', () => ({
  readSessionSandboxFile: vi.fn(),
  writeSessionSandboxFile: vi.fn(),
}))
vi.mock('@/lib/execution/remote-sandbox/session-file-snapshot', () => ({
  openSessionFileSnapshot: vi.fn(),
}))
vi.mock('@/lib/mothership/chat/delegation', () => ({ mintDelegationToken: async () => 'fixture' }))

import { createFileReadTransport } from '@/lib/mothership/agent-cli/file-read-transport'
import { inspectToolResultForCopilot } from '@/lib/mothership/request/tools/resolved-secret-result'
import { executeSimCli } from '@/lib/mothership/tools/handlers/sim-cli'
import { readWorkspaceFileArtifact } from '@/lib/workspace-files/application/read-workspace-file-artifact'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const principal = { kind: 'personal_api_key', userId: 'reader', keyId: 'fixture-key' } as const
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
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.permission.mockResolvedValue('read')
    mocks.authenticate.mockResolvedValue({ principal })
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
    expect(mocks.authenticate).toHaveBeenCalledWith('fixture')
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

  it('checks current permission before opening storage', async () => {
    mocks.permission.mockResolvedValue(null)
    const response = await readTransport()(fileRequest())
    expect(response.status).toBe(404)
    expect(mocks.stream).not.toHaveBeenCalled()
    expect(mocks.buffer).not.toHaveBeenCalled()
  })

  it('rejects a credential for a different actor before looking up the file', async () => {
    mocks.authenticate.mockResolvedValue({ principal: { ...principal, userId: 'someone-else' } })
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
    expect(mocks.authenticate).not.toHaveBeenCalled()
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
    mocks.authenticate.mockImplementation(async () => {
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
