import { workspaceFiles } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { toolsMock, toolsMockFns } from '@sim/testing/mocks/tools.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from '@sim/testing/mocks/workspace-file-manager.mock'
import {
  workspaceFilesListMock,
  workspaceFilesListMockFns,
} from '@sim/testing/mocks/workspace-files-list.mock'
import { workspaceUploadsMock } from '@sim/testing/mocks/workspace-uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  render: vi.fn(),
  attachment: vi.fn(),
}))
vi.mock('@/lib/mothership/chat/application/read-attachment', () => ({
  readChatAttachment: { execute: hoisted.attachment },
}))
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => workspaceFileManagerMock)
vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)
vi.mock('@/lib/workspace-files/application/list-workspace-files', () => workspaceFilesListMock)
vi.mock('@/lib/workspace-files/application/fetch-servable-workspace-file-buffer', () => ({
  fetchAuthorizedServableWorkspaceFileBuffer: hoisted.render,
}))
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/tools', () => toolsMock)

import type { SandboxFile } from '@/lib/execution/remote-sandbox/types'
import { inspectToolResultForCopilot } from '@/lib/mothership/request/tools/resolved-secret-result'
import type { ToolExecutionContext } from '@/lib/mothership/tool-executor/types'
import {
  executeFunctionExecute,
  resolveInputFiles,
} from '@/lib/mothership/tools/handlers/function-execute'
import { createWorkspaceFileSecretProvenanceFromRegistry } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { readWorkspaceFileMount } from '@/lib/workspace-files/application/read-workspace-file-mount'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const mocks = {
  ...hoisted,
  list: workspaceFilesListMockFns.mockListAllWorkspaceFiles,
  file: workspaceFileManagerMockFns.mockGetWorkspaceFile,
  context: workspaceFileManagerMockFns.mockLoadActiveWorkspaceFileContext,
  buffer: workspaceFileManagerMockFns.mockFetchWorkspaceFileBuffer,
  permission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  cloud: storageServiceMockFns.mockHasCloudStorage,
  presign: storageServiceMockFns.mockGeneratePresignedDownloadUrl,
  decrypt: encryptionMockFns.mockDecryptSecret,
}

/** Reinstalls the file-manager helpers this suite fixes, after `vi.resetAllMocks()` restores defaults. */
function pinFileManagerHelpers() {
  workspaceFileManagerMockFns.mockFindWorkspaceFileRecord.mockImplementation(
    (files: { id: string }[], id: string) => files.find((candidate) => candidate.id === id)
  )
  workspaceFileManagerMockFns.mockGetSandboxWorkspaceFilePath.mockReturnValue(
    '/home/user/files/source.txt'
  )
  workspaceFileManagerMockFns.mockParseChatUploadReference.mockReturnValue(null)
}

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
    pinFileManagerHelpers()
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

  /**
   * The run's code can read every mounted byte, so the per-call registry the Copilot projection
   * and output-file writers read must carry the mount's own verdict across the crossing: a
   * tainted mount stays a taint (never the `unrecorded` absence) and names the guard that tripped,
   * while exact mounts keep redacting and clean mounts stay readable.
   */
  it.each(['safe', 'secret', 'unknown'] as const)(
    'carries a %s mount verdict across the run_code crossing',
    async (kind) => {
      queueProvenance(kind === 'unknown' ? 'unknown' : 'exact', revision, kind === 'secret')
      toolsMockFns.mockExecuteTool.mockResolvedValue({
        success: true,
        output: { result: content, stdout: content },
      })
      const trace = new ResolvedSecretTraceRegistry([], {
        userId: 'reader',
        workspaceId: 'workspace',
      })
      const result = await executeFunctionExecute(
        {
          code: "print(open('/tmp/source.txt').read())",
          language: 'python',
          inputs: { files: [{ path: 'file', sandboxPath: '/tmp/source.txt' }] },
        },
        { ...context, resolvedSecretTraceRegistry: trace }
      )

      const observation = inspectToolResultForCopilot(result, trace, 'run_code')
      const written = await createWorkspaceFileSecretProvenanceFromRegistry(trace, result.output, {
        userId: 'reader',
        workspaceId: 'workspace',
      })
      expect(JSON.stringify(observation.result).includes(content)).toBe(kind === 'safe')
      if (kind === 'unknown') {
        expect(observation.safe).toBe(false)
        expect.soft(observation.safe ? undefined : observation.cause).toMatchObject({
          kind: 'registry-incomplete',
          reasons: expect.arrayContaining(['mounted-file-provenance-unavailable']),
        })
        expect.soft(written).toEqual({ safe: false })
        expect(observation.result.output).toEqual({
          resultWithheld: true,
          withheldReason: expect.stringMatching(
            /file, table, or document .* unknown secret provenance/
          ),
        })
      } else {
        expect(observation.safe).toBe(true)
        expect(written).toMatchObject({
          safe: true,
          provenance: {
            status: 'exact',
            // A mounted file's secret crosses anonymously: its ciphertext binds it, not a name.
            entries:
              kind === 'secret'
                ? [
                    {
                      encryptedValue: 'fixture-ciphertext',
                      sourceUserId: 'reader',
                      sourceWorkspaceId: 'workspace',
                    },
                  ]
                : [],
          },
        })
      }
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
        principal: createSessionPrincipal({ userId: 'reader', sessionId: 'fixture' }),
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

describe('organization-owned upload mounts', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    pinFileManagerHelpers()
    mocks.attachment.mockResolvedValue({
      id: 'upload',
      name: 'data.txt',
      buffer: Buffer.from('public input'),
    })
  })
  it('mounts the exact authorized private chat upload with no workspace lookup', async () => {
    const registry = new ResolvedSecretTraceRegistry([], { userId: 'reader' })
    const result = await resolveInputFiles(
      {
        ...context,
        workspaceId: undefined,
        organizationId: 'org',
        resolvedSecretTraceRegistry: registry,
      },
      [{ path: 'uploads/upload', sandboxPath: '/tmp/input.txt' }],
      [],
      [],
      registry
    )
    expect(result).toEqual([
      {
        path: '/tmp/input.txt',
        content: Buffer.from('public input').toString('base64'),
        encoding: 'base64',
      },
    ])
    expect(mocks.attachment).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        kind: 'organization_delegated',
        organizationId: 'org',
        subjectUserId: 'reader',
        resourceScope: { chatId: 'chat' },
      }),
      input: expect.objectContaining({ chatId: 'chat', reference: 'uploads/upload' }),
    })
    expect(mocks.list).not.toHaveBeenCalled()
    expect(registry.isComplete()).toBe(true)
  })
  it.each(['missing', 'absence', 'matching-secret'] as const)(
    'accepts intentionally uploaded bytes with $0 source provenance without activating them',
    async (source) => {
      const parent = new ResolvedSecretTraceRegistry([], { userId: 'reader' })
      if (source === 'absence') parent.markIncomplete('source-provenance-incomplete')
      if (source === 'matching-secret') {
        mocks.decrypt.mockResolvedValue({ decrypted: 'public input' })
        await parent.importProvenance(
          {
            version: 1,
            complete: true,
            scope: { userId: 'reader' },
            entries: [{ name: 'TOKEN', encryptedValue: 'encrypted:public input' }],
          },
          { trusted: true }
        )
      }
      const registry = new ResolvedSecretTraceRegistry([], { userId: 'reader' })
      const result = await resolveInputFiles(
        {
          ...context,
          workspaceId: undefined,
          organizationId: 'org',
          ...(source === 'missing' ? {} : { resolvedSecretTraceRegistry: parent }),
        },
        [{ path: 'uploads/upload', sandboxPath: '/tmp/input.txt' }],
        [],
        [],
        registry
      )
      expect(result).toEqual([
        {
          path: '/tmp/input.txt',
          content: Buffer.from('public input').toString('base64'),
          encoding: 'base64',
        },
      ])
      expect(registry.exportCheckpointProvenance()).toMatchObject({ complete: true, entries: [] })
    }
  )
  it('does not repair an existing protection fault when an intentional upload is mounted', async () => {
    const registry = new ResolvedSecretTraceRegistry([], { userId: 'reader' })
    registry.markIncomplete('entry-decrypt-failed')
    const result = await resolveInputFiles(
      {
        ...context,
        workspaceId: undefined,
        organizationId: 'org',
        resolvedSecretTraceRegistry: registry,
      },
      [{ path: 'uploads/upload' }],
      [],
      [],
      registry
    )
    expect(result).toHaveLength(1)
    expect(registry.isPermanentlyIncomplete()).toBe(true)
  })
  it('requires a target for workspace files and never treats missing upload authority as a workspace fallback', async () => {
    const registry = new ResolvedSecretTraceRegistry([], { userId: 'reader' })
    await expect(
      resolveInputFiles(
        { ...context, workspaceId: undefined, organizationId: 'org' },
        [{ path: 'files/secret.txt' }],
        [],
        [],
        registry
      )
    ).rejects.toThrow('explicit workspace')
    mocks.attachment.mockRejectedValue(new Error('Attachment not found'))
    await expect(
      resolveInputFiles(
        { ...context, workspaceId: undefined, organizationId: 'org' },
        [{ path: 'uploads/foreign' }],
        [],
        [],
        registry
      )
    ).rejects.toThrow('Attachment not found')
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
