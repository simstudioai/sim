/** @vitest-environment node */
import { workspaceFiles } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  file: vi.fn(),
  list: vi.fn(),
  context: vi.fn(),
  buffer: vi.fn(),
  permission: vi.fn(),
  cloud: vi.fn(),
  presign: vi.fn(),
  render: vi.fn(),
  decrypt: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null) => actual === 'read',
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFile: mocks.file,
  fetchWorkspaceFileBuffer: mocks.buffer,
  loadActiveWorkspaceFileContext: mocks.context,
  findWorkspaceFileRecord: (files: { id: string }[], id: string) =>
    files.find((file) => file.id === id),
  getSandboxWorkspaceFilePath: () => '/home/user/files/source.txt',
  parseChatUploadReference: () => null,
}))
vi.mock('@/lib/uploads/contexts/workspace', () => ({
  getWorkspaceFile: mocks.file,
  fetchWorkspaceFileBuffer: mocks.buffer,
}))
vi.mock('@/lib/workspace-files/application/list-workspace-files', () => ({
  listAllWorkspaceFiles: { execute: mocks.list },
}))
vi.mock('@/lib/workspace-files/application/fetch-servable-workspace-file-buffer', () => ({
  fetchAuthorizedServableWorkspaceFileBuffer: mocks.render,
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  hasCloudStorage: mocks.cloud,
  generatePresignedDownloadUrl: mocks.presign,
}))
vi.mock('@/lib/core/security/encryption', () => ({ decryptSecret: mocks.decrypt }))
vi.mock('@/tools', () => ({ executeTool: vi.fn() }))

import type { SandboxFile } from '@/lib/execution/remote-sandbox/types'
import { inspectToolResultForCopilot } from '@/lib/mothership/request/tools/resolved-secret-result'
import type { ToolExecutionContext } from '@/lib/mothership/tool-executor/types'
import { resolveInputFiles } from '@/lib/mothership/tools/handlers/function-execute'
import { readWorkspaceFileMount } from '@/lib/workspace-files/application/read-workspace-file-mount'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const revision = new Date('2026-09-06T00:00:00Z')
const content = 'FILE_MOUNT_TEST_SECRET'
const file = {
  id: 'file',
  workspaceId: 'workspace',
  name: 'source.txt',
  key: 'workspace/workspace/old-key',
  size: content.length,
  type: 'text/plain',
  storageContext: 'workspace',
  contentUpdatedAt: revision,
}
const context: ToolExecutionContext = {
  userId: 'reader',
  workspaceId: 'workspace',
  chatId: 'chat',
  toolCallId: 'mount',
  copilotToolExecution: true,
  sandboxProfile: 'mothership',
}

function queueProvenance(status: 'exact' | 'unknown', currentRevision = revision, secret = false) {
  queueTableRows(workspaceFiles, [
    {
      fileContentUpdatedAt: currentRevision,
      provenanceContentUpdatedAt: currentRevision,
      secretProvenanceVersion: 1,
      status,
      entries: secret
        ? [{ name: 'MOUNT_SECRET', encryptedValue: 'fixture-ciphertext', sourceUserId: 'reader' }]
        : [],
    },
  ])
}

function run(
  trace = new ResolvedSecretTraceRegistry([], { userId: 'reader', workspaceId: 'workspace' }),
  overrides: Partial<ToolExecutionContext> = {}
) {
  return resolveInputFiles(
    { ...context, ...overrides },
    [{ path: 'file', sandboxPath: '/tmp/source.txt' }],
    undefined,
    undefined,
    trace
  )
}

function mountedBytes(mounts: SandboxFile[]) {
  expect(mounts).toHaveLength(1)
  const mount = mounts[0]
  if (!mount || mount.type === 'url') throw new Error('Expected inline mount bytes')
  expect(mount.path).toBe('/tmp/source.txt')
  return Buffer.from(mount.content, mount.encoding ?? 'utf8')
}

describe('Mothership file mounts bind content and classification to the same record', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetDbChainMock()
    mocks.file.mockResolvedValue(file)
    mocks.list.mockResolvedValue({ files: [file] })
    mocks.context.mockResolvedValue({
      workspaceId: 'workspace',
      fileId: 'file',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'owner',
    })
    mocks.permission.mockResolvedValue('read')
    mocks.cloud.mockReturnValue(false)
    mocks.buffer.mockResolvedValue(Buffer.from(content))
    mocks.decrypt.mockResolvedValue({ decrypted: content })
    mocks.presign.mockResolvedValue('https://storage.test/old-key')
  })

  it('never reloads a different content version after choosing the mount source', async () => {
    const replacement = {
      ...file,
      key: 'workspace/workspace/new-key',
      contentUpdatedAt: new Date(revision.getTime() + 1),
    }
    mocks.file.mockResolvedValueOnce(file).mockResolvedValue(replacement)
    mocks.buffer.mockImplementation(async (record: typeof file) =>
      Buffer.from(record.key === file.key ? 'original safe content' : content)
    )
    queueProvenance('exact')
    const mounts = await run()
    expect(mountedBytes(mounts).toString()).toBe('original safe content')
    expect(mocks.file).toHaveBeenCalledTimes(1)
    expect(mocks.buffer).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ maxBytes: 10 * 1024 * 1024 })
    )
  })

  it('does not certify old bytes using a newer exact-empty sidecar at the same key', async () => {
    queueProvenance('exact', new Date(revision.getTime() + 1))
    const trace = new ResolvedSecretTraceRegistry([], {
      userId: 'reader',
      workspaceId: 'workspace',
    })
    const mounts = await run(trace)
    expect(mountedBytes(mounts).toString()).toBe(content)
    const observation = inspectToolResultForCopilot(
      { success: true, output: content },
      trace,
      'run_code'
    )
    expect(JSON.stringify(observation.result)).not.toContain(content)
  })

  it.each(['safe', 'secret', 'unknown'] as const)(
    'preserves %s classification for stable buffered bytes',
    async (kind) => {
      queueProvenance(kind === 'unknown' ? 'unknown' : 'exact', revision, kind === 'secret')
      const trace = new ResolvedSecretTraceRegistry([], {
        userId: 'reader',
        workspaceId: 'workspace',
      })
      expect(mountedBytes(await run(trace)).toString()).toBe(content)
      const observation = inspectToolResultForCopilot(
        { success: true, output: content },
        trace,
        'run_code'
      )
      expect(JSON.stringify(observation.result).includes(content)).toBe(kind === 'safe')
    }
  )

  it('denies revoked access before content or signed URL acquisition', async () => {
    mocks.permission.mockResolvedValue(null)
    await expect(run()).rejects.toThrow('permissions')
    expect(mocks.file).not.toHaveBeenCalled()
    expect(mocks.buffer).not.toHaveBeenCalled()
    expect(mocks.presign).not.toHaveBeenCalled()
  })

  it('preserves arbitrary bytes even when the stored MIME claims text', async () => {
    const bytes = Buffer.from([0, 255, 13, 10, 128, 195, 0])
    mocks.buffer.mockResolvedValue(bytes)
    queueProvenance('exact')
    expect(mountedBytes(await run())).toEqual(bytes)
  })

  it('uses the same canonical key for a cloud mount without buffering its content', async () => {
    mocks.cloud.mockReturnValue(true)
    queueProvenance('exact')
    expect(await run()).toEqual([
      {
        type: 'url',
        path: '/tmp/source.txt',
        url: 'https://storage.test/old-key',
        maxBytes: file.size,
      },
    ])
    expect(mocks.presign).toHaveBeenCalledWith(file.key, 'workspace', 1800)
    expect(mocks.buffer).not.toHaveBeenCalled()
  })

  it.each(['missing revision', 'sidecar outage'])(
    'withholds model output on %s without discarding runtime bytes',
    async (failure) => {
      if (failure === 'missing revision')
        mocks.file.mockResolvedValue({ ...file, contentUpdatedAt: null })
      else dbChainMockFns.limit.mockRejectedValueOnce(new Error('Classification unavailable'))
      const trace = new ResolvedSecretTraceRegistry([], {
        userId: 'reader',
        workspaceId: 'workspace',
      })
      expect(mountedBytes(await run(trace)).toString()).toBe(content)
      expect(trace.isPermanentlyIncomplete()).toBe(true)
      expect(
        JSON.stringify(
          inspectToolResultForCopilot({ success: true, output: content }, trace, 'run_code').result
        )
      ).not.toContain(content)
    }
  )

  it('does not use a newer sidecar to certify a signed mount either', async () => {
    mocks.cloud.mockReturnValue(true)
    queueProvenance('exact', new Date(revision.getTime() + 1))
    const trace = new ResolvedSecretTraceRegistry([], {
      userId: 'reader',
      workspaceId: 'workspace',
    })
    const mounts = await run(trace)
    expect(mounts[0]).toMatchObject({ type: 'url' })
    expect(trace.isPermanentlyIncomplete()).toBe(true)
  })

  it('renders generated documents with the acting principal and retains the rendered bytes', async () => {
    const document = { ...file, name: 'report.docx', type: 'text/x-docxjs' }
    const bytes = Buffer.from([80, 75, 255, 128, 0])
    mocks.file.mockResolvedValue(document)
    mocks.cloud.mockReturnValue(true)
    mocks.render.mockResolvedValue({ buffer: bytes, contentType: 'application/octet-stream' })
    queueProvenance('exact')
    expect(mountedBytes(await run())).toEqual(bytes)
    expect(mocks.render).toHaveBeenCalledWith(
      document,
      expect.objectContaining({ kind: 'delegated', subjectUserId: 'reader' }),
      expect.objectContaining({ maxBytes: 10 * 1024 * 1024 })
    )
    expect(mocks.buffer).not.toHaveBeenCalled()
    expect(mocks.presign).not.toHaveBeenCalled()
  })

  it('stops before acquiring a mount when the tool was already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('Stopped'))
    await expect(run(undefined, { abortSignal: controller.signal })).rejects.toThrow('Stopped')
    expect(mocks.context).not.toHaveBeenCalled()
    expect(mocks.buffer).not.toHaveBeenCalled()
    expect(mocks.presign).not.toHaveBeenCalled()
  })

  it('does not hand completed bytes to the runtime after Stop during their read', async () => {
    const controller = new AbortController()
    mocks.buffer.mockImplementation(async () => {
      controller.abort(new Error('Stopped during read'))
      return Buffer.from(content)
    })
    await expect(run(undefined, { abortSignal: controller.signal })).rejects.toThrow(
      'Stopped during read'
    )
    expect(mocks.buffer).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('does not charge the supplied mount budget when byte acquisition fails', async () => {
    const budget = { buffered: 40 * 1024 * 1024, url: 500 }
    mocks.buffer.mockRejectedValue(new Error('Storage unavailable'))
    await expect(
      readWorkspaceFileMount.execute({
        principal: { kind: 'session', userId: 'reader', sessionId: 'fixture' },
        input: {
          fileId: 'file',
          assertedWorkspaceId: 'workspace',
          mountPath: '/tmp/source.txt',
          budget,
        },
      })
    ).rejects.toThrow('Storage unavailable')
    expect(budget).toEqual({ buffered: 40 * 1024 * 1024, url: 500 })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})
