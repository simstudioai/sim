/** @vitest-environment node */
import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { workspaceFiles } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  stream: vi.fn(),
  head: vi.fn(),
  permission: vi.fn(),
  authenticate: vi.fn(),
  decrypt: vi.fn(),
  create: vi.fn(),
  complete: vi.fn(),
  receipts: new Map<string, string>(),
  logError: vi.fn(),
}))
vi.mock('@sim/logger', () => ({
  createLogger: () => ({ error: mocks.logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/uploads/upload-session/application', () => ({
  createWorkspaceFileUploadOperation: { execute: mocks.create },
  completeWorkspaceFileUploadOperation: { execute: mocks.complete },
}))
vi.mock('@/lib/core/config/redis', () => ({
  getConfiguredRedisUrl: () => null,
  onRedisReconnect: () => {},
  getRedisClient: () => ({
    eval: async (_script: string, _keys: number, key: string, value: string) => {
      mocks.receipts.set(key, value)
      return 1
    },
    get: async (key: string) => mocks.receipts.get(key) ?? null,
  }),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null) => permission === 'read',
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: class extends Error {},
}))
vi.mock('@/lib/mothership/chat/delegation', () => ({ mintDelegationToken: async () => 'fixture' }))
vi.mock('@/lib/core/security/encryption', () => ({ decryptSecret: mocks.decrypt }))
vi.mock('@/lib/realtime/notify', () => ({
  mergeEditIntoLiveFileDoc: vi.fn(),
  notifyWorkspaceFilesChanged: vi.fn(),
}))
vi.mock('@/lib/billing/storage', () => ({
  decrementStorageUsageForBillingContextInTx: vi.fn(),
  incrementStorageUsageForBillingContextInTx: vi.fn(async () => 100),
  maybeNotifyStorageLimitForBillingContext: vi.fn(),
  resolveStorageBillingContext: vi.fn(async () => ({ workspaceId: 'workspace' })),
}))
vi.mock('@/lib/uploads', () => ({ getServePathPrefix: () => '/api/files/serve/s3/' }))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  deleteFile: vi.fn(),
  downloadFile: vi.fn(),
  downloadFileStream: mocks.stream,
  hasCloudStorage: () => true,
  headObject: mocks.head,
  uploadFile: vi.fn(),
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox', () => ({
  enqueueWorkspaceFileStorageCleanup: vi.fn(),
  processWorkspaceFileStorageCleanupNow: vi.fn(),
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  assertWorkspaceFileFolderTarget: async () => null,
  buildWorkspaceFileFolderPathMap: () => new Map(),
  fileNameExistsInWorkspaceFolder: async () => false,
  findWorkspaceFileFolderIdByPath: vi.fn(),
  getWorkspaceFileFolderPath: vi.fn(),
  listWorkspaceFileFolders: async () => [],
  normalizeWorkspaceFileItemName: (name: string) => name,
  resolveWorkspaceFileFolderTarget: async () => null,
}))
vi.mock('@/lib/folders/locks', () => ({ acquireFolderMutationLock: vi.fn() }))
vi.mock('@/lib/users/queries', () => ({
  getUserEmailsByIds: async () => new Map([['reader', 'reader@example.test']]),
  requireResolvedUserEmail: (values: Map<string, string>, id: string) => {
    const email = values.get(id)
    if (!email) throw new Error(`Missing fixture attribution for ${id}`)
    return email
  },
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({ getWorkspaceWithOwner: vi.fn() }))
vi.mock('@/lib/execution/remote-sandbox/provider', () => ({
  resolveProvider: () => ({
    id: 'e2b',
    findSessionSandbox: mocks.find,
    resolveLifetimeMs: (milliseconds: number) => milliseconds,
  }),
}))
vi.mock('@/lib/execution/remote-sandbox/session-lock', () => ({
  withSandboxSessionLock: async <T>(
    _key: string,
    signal: AbortSignal,
    action: (signal: AbortSignal) => Promise<T>
  ): Promise<T> => action(signal),
}))

import { inspectToolResultForCopilot } from '@/lib/mothership/request/tools/resolved-secret-result'
import { executeSimCli } from '@/lib/mothership/tools/handlers/sim-cli'
import {
  getWorkspaceFile,
  registerUploadedWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const WORKSPACE = '7727ef3f-8cf6-4686-b063-2bb006a10785'
const CONTENT = 'ROUND_TRIP_CANARY_ONLY_FOR_LOCAL_TEST'
const REVISION = new Date('2026-09-06T00:00:00Z')
const PRINCIPAL = { kind: 'personal_api_key', userId: 'reader', keyId: 'fixture-key' } as const
const SOURCE = {
  id: 'source',
  key: `workspace/${WORKSPACE}/123-abc-source.txt`,
  userId: 'reader',
  workspaceId: WORKSPACE,
  folderId: null,
  context: 'workspace',
  chatId: null,
  originalName: 'source.txt',
  displayName: 'source.txt',
  contentType: 'text/plain',
  size: Buffer.byteLength(CONTENT),
  sizeBytes: Buffer.byteLength(CONTENT),
  deletedAt: null,
  uploadedAt: REVISION,
  updatedAt: REVISION,
  contentUpdatedAt: REVISION,
  secretProvenanceVersion: 1,
}
const PUBLISHED = {
  ...SOURCE,
  id: 'published',
  key: `workspace/${WORKSPACE}/124-def-published.txt`,
  originalName: 'published.txt',
  displayName: 'published.txt',
}
const SESSION = {
  id: 'upload',
  status: 'uploading',
  fileName: PUBLISHED.originalName,
  contentType: PUBLISHED.contentType,
  fileSize: SOURCE.size,
  expiresAt: new Date('2099-01-01'),
  error: null,
  uploadToken: 'fixture',
  transfer: { method: 'put', url: 'https://upload.test/bytes', headers: {} },
}

function registry() {
  return new ResolvedSecretTraceRegistry([], { userId: 'reader', workspaceId: WORKSPACE })
}

function queueRead(file: typeof SOURCE, provenance: WorkspaceFileSecretProvenance) {
  queueTableRows(workspaceFiles, [
    {
      workspaceId: WORKSPACE,
      fileId: file.id,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'owner',
    },
  ])
  queueTableRows(workspaceFiles, [file])
  queueTableRows(workspaceFiles, [
    {
      fileContentUpdatedAt: REVISION,
      secretProvenanceVersion: 1,
      provenanceContentUpdatedAt: REVISION,
      ...provenance,
      entries: provenance.status === 'exact' ? provenance.entries : [],
    },
  ])
}

function execute(argv: string[], trace: ResolvedSecretTraceRegistry) {
  return executeSimCli(
    { request: { invocation: { kind: 'cli', argv } } },
    {
      userId: 'reader',
      workspaceId: WORKSPACE,
      workflowId: '',
      chatId: 'chat',
      resolvedSecretTraceRegistry: trace,
    }
  )
}

let directory: string
let uploaded: Buffer | undefined
let registered: boolean
let storedProvenance: WorkspaceFileSecretProvenance | undefined

beforeEach(async () => {
  vi.clearAllMocks()
  resetDbChainMock()
  uploaded = undefined
  registered = false
  storedProvenance = undefined
  mocks.receipts.clear()
  directory = await mkdtemp(join(tmpdir(), 'mship-round-trip-'))
  mocks.permission.mockResolvedValue('read')
  mocks.authenticate.mockResolvedValue({ principal: PRINCIPAL })
  mocks.decrypt.mockResolvedValue({ decrypted: CONTENT })
  mocks.stream.mockImplementation(async ({ key }: { key: string }) => {
    if (key === PUBLISHED.key) {
      expect(registered).toBe(true)
      expect(uploaded).toBeDefined()
      return Readable.from(uploaded)
    }
    expect(key).toBe(SOURCE.key)
    return Readable.from(Buffer.from(CONTENT))
  })
  mocks.head.mockImplementation(async () => ({ size: uploaded?.byteLength ?? 0 }))
  const exec = promisify(execFile)
  mocks.find.mockResolvedValue({
    sandboxId: 'fixture-machine',
    writeFile: async (path: string, content: string | ArrayBuffer) =>
      writeFile(path, typeof content === 'string' ? content : new Uint8Array(content)),
    writeFileStream: async (path: string, body: ReadableStream<Uint8Array>) =>
      writeFile(path, Buffer.from(await new Response(body).arrayBuffer())),
    readFileStream: async (path: string, options: { signal: AbortSignal }) =>
      Readable.toWeb(createReadStream(path, { signal: options.signal })),
    getFileSize: async (path: string) => (await stat(path)).size,
    removeFile: async (path: string) => rm(path, { force: true }),
    runCommand: async (
      command: string,
      options: { envs: Record<string, string>; signal: AbortSignal }
    ) => {
      const result = await exec('/bin/sh', ['-c', command], {
        env: { ...process.env, ...options.envs },
        signal: options.signal,
      })
      return { ...result, exitCode: 0 }
    },
  })
  mocks.create.mockImplementation(async ({ principal, input, secretProvenance }) => {
    expect(principal).toEqual(PRINCIPAL)
    expect(input.size).toBe(Buffer.byteLength(CONTENT))
    expect(secretProvenance).toBe('pending')
    expect(mocks.complete).not.toHaveBeenCalled()
    return SESSION
  })
  mocks.complete.mockImplementation(async ({ principal, secretProvenance }) => {
    expect(principal).toEqual(PRINCIPAL)
    expect(uploaded?.toString()).toBe(CONTENT)
    dbChainMockFns.returning
      .mockResolvedValueOnce([PUBLISHED])
      .mockResolvedValueOnce([{ id: PUBLISHED.id }])
    const result = await registerUploadedWorkspaceFile({
      workspaceId: WORKSPACE,
      userId: 'reader',
      key: PUBLISHED.key,
      originalName: PUBLISHED.originalName,
      contentType: PUBLISHED.contentType,
      secretProvenance,
    })
    expect(result.created).toBe(true)
    const sidecar = dbChainMockFns.values.mock.calls
      .map(([value]) => value)
      .find((value) => value.fileId === PUBLISHED.id && 'entries' in value)
    expect(sidecar).toMatchObject({ contentUpdatedAt: REVISION })
    storedProvenance =
      sidecar.status === 'exact'
        ? { status: 'exact', entries: sidecar.entries }
        : { status: 'unknown' }
    registered = true
    queueTableRows(workspaceFiles, [PUBLISHED])
    const file = await getWorkspaceFile(WORKSPACE, result.file.id, { throwOnError: true })
    expect(file?.uploadedBy).toBe('reader')
    return { session: { ...SESSION, status: 'completed' }, value: file }
  })
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.origin === 'https://upload.test') {
      uploaded = Buffer.from(await request.arrayBuffer())
      expect(uploaded.toString()).toBe(CONTENT)
      return new Response(null, { status: 200 })
    }
    throw new Error(`Unexpected network control request: ${url.pathname}`)
  })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(directory, { recursive: true, force: true })
})

/** Application adapters stand in for session/provider control; registration and observation are real. */
describe('download → workbench copy → private upload adapter → registration → fresh observation', () => {
  it.each(['unknown', 'secret', 'safe'] as const)(
    'preserves the %s source classification across separate tool calls',
    async (classification) => {
      const sourceProvenance: WorkspaceFileSecretProvenance =
        classification === 'unknown'
          ? { status: 'unknown' }
          : {
              status: 'exact',
              entries:
                classification === 'safe'
                  ? []
                  : [
                      {
                        name: 'FILE_SECRET',
                        encryptedValue: 'fixture-ciphertext',
                        sourceUserId: 'reader',
                      },
                    ],
            }
      queueRead(SOURCE, sourceProvenance)
      const downloadTrace = registry()
      const input = join(directory, 'download.txt')
      const download = await execute(['files', 'get', SOURCE.id, '-o', input], downloadTrace)
      expect(download, JSON.stringify(download)).toMatchObject({ success: true })
      expect(await readFile(input, 'utf8')).toBe(CONTENT)
      expect([...mocks.receipts.values()].join()).not.toContain(CONTENT)
      const sourceObservation = JSON.stringify(
        inspectToolResultForCopilot({ success: true, output: CONTENT }, downloadTrace, 'sim_cli')
          .result
      )
      expect(sourceObservation.includes(CONTENT)).toBe(classification === 'safe')

      const derived = join(directory, 'derived.txt')
      await copyFile(input, derived)
      const upload = await execute(['files', 'upload', derived], registry())
      expect(
        mocks.logError.mock.calls.filter(([message]) => message === 'File upload control failed')
      ).toEqual([])
      expect(upload, JSON.stringify(upload)).toMatchObject({ success: true })
      expect(uploaded?.toString()).toBe(CONTENT)
      expect(registered).toBe(true)
      expect(storedProvenance).toBeDefined()
      if (!storedProvenance) throw new Error('No publication classification was persisted')

      queueRead(PUBLISHED, storedProvenance)
      const readTrace = registry()
      const reread = await execute(['files', 'get', PUBLISHED.id], readTrace)
      expect(reread, JSON.stringify(reread)).toMatchObject({ success: true })
      expect(JSON.stringify(reread.output)).toContain(CONTENT)
      const observation = JSON.stringify(
        inspectToolResultForCopilot(reread, readTrace, 'sim_cli').result
      )
      expect(observation.includes(CONTENT)).toBe(classification === 'safe')
    }
  )
})
