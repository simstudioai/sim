/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const {
  createWorkspaceFileSecretProvenanceFromRegistryMock,
  fetchWorkspaceFileBufferMock,
  getBoundWorkspaceFileSecretProvenanceMock,
  mergeWorkspaceFileSecretProvenanceMock,
  resolveWorkspaceFileReferenceMock,
  runFfmpegOperationMock,
  writeWorkspaceFileByPathMock,
} = vi.hoisted(() => ({
  createWorkspaceFileSecretProvenanceFromRegistryMock: vi.fn(),
  fetchWorkspaceFileBufferMock: vi.fn(),
  getBoundWorkspaceFileSecretProvenanceMock: vi.fn(),
  mergeWorkspaceFileSecretProvenanceMock: vi.fn(),
  resolveWorkspaceFileReferenceMock: vi.fn(),
  runFfmpegOperationMock: vi.fn(),
  writeWorkspaceFileByPathMock: vi.fn(),
}))

vi.mock('@/lib/copilot/generated/tool-catalog-v1', () => ({
  Ffmpeg: { id: 'ffmpeg' },
}))

vi.mock('@/lib/copilot/vfs/resource-writer', () => ({
  writeCopilotWorkspaceFileByPath: (_context: unknown, args: unknown) =>
    writeWorkspaceFileByPathMock(args),
}))

vi.mock('@/lib/copilot/application/execute-file-use-case', () => ({
  executeCopilotFileUseCase: async () => ({
    file,
    content: await fetchWorkspaceFileBufferMock(file),
  }),
  resolveCopilotWorkspaceFileReference: (...args: unknown[]) =>
    resolveWorkspaceFileReferenceMock(...args),
}))

vi.mock('@/lib/media/ffmpeg', () => ({
  runFfmpegOperation: runFfmpegOperationMock,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: fetchWorkspaceFileBufferMock,
  resolveWorkspaceFileReference: resolveWorkspaceFileReferenceMock,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  createWorkspaceFileSecretProvenanceFromRegistry:
    createWorkspaceFileSecretProvenanceFromRegistryMock,
  getBoundWorkspaceFileSecretProvenance: getBoundWorkspaceFileSecretProvenanceMock,
  mergeWorkspaceFileSecretProvenance: mergeWorkspaceFileSecretProvenanceMock,
}))

import { ffmpegServerTool } from '@/lib/copilot/tools/server/media/ffmpeg'

const EXACT_EMPTY = { status: 'exact' as const, entries: [] }
const TRACKED = {
  status: 'exact' as const,
  entries: [
    {
      name: 'MEDIA_SECRET',
      encryptedValue: 'encrypted-media-secret',
      sourceUserId: 'user-1',
      sourceWorkspaceId: 'workspace-1',
    },
  ],
}
const TEXT_PROVENANCE = {
  status: 'exact' as const,
  entries: [
    {
      name: 'CAPTION',
      encryptedValue: 'encrypted-caption',
      sourceUserId: 'user-1',
      sourceWorkspaceId: 'workspace-1',
    },
  ],
}

const file = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'input.mp4',
  key: 'workspace/workspace-1/input.mp4',
  path: '/api/files/serve/input.mp4',
  size: 10,
  type: 'video/mp4',
  uploadedBy: 'user-1',
  uploadedAt: new Date('2026-08-05T00:00:00.000Z'),
  updatedAt: new Date('2026-08-05T00:00:00.000Z'),
  storageContext: 'workspace' as const,
}

function mergeProvenance(
  ...values: WorkspaceFileSecretProvenance[]
): WorkspaceFileSecretProvenance {
  if (values.some((value) => value.status === 'unknown')) return { status: 'unknown' }
  return {
    status: 'exact',
    entries: values.flatMap((value) => (value.status === 'exact' ? value.entries : [])),
  }
}

describe('ffmpeg server tool secret provenance', () => {
  const registry = new ResolvedSecretTraceRegistry([], {
    userId: 'user-1',
    workspaceId: 'workspace-1',
  })
  const context = {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    toolCallId: 'tool-1',
    copilotToolExecution: true as const,
    resolvedSecretTraceRegistry: registry,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resolveWorkspaceFileReferenceMock.mockResolvedValue(file)
    fetchWorkspaceFileBufferMock.mockResolvedValue(Buffer.from('media'))
    getBoundWorkspaceFileSecretProvenanceMock.mockResolvedValue(EXACT_EMPTY)
    mergeWorkspaceFileSecretProvenanceMock.mockImplementation(mergeProvenance)
    createWorkspaceFileSecretProvenanceFromRegistryMock.mockResolvedValue({
      safe: true,
      provenance: EXACT_EMPTY,
    })
    runFfmpegOperationMock.mockResolvedValue({
      buffer: Buffer.from('output'),
      ext: 'mp4',
      contentType: 'video/mp4',
    })
    writeWorkspaceFileByPathMock.mockResolvedValue({
      id: 'output-1',
      name: 'converted.mp4',
      vfsPath: 'files/converted.mp4',
      downloadUrl: '/api/files/serve/converted.mp4',
      mode: 'create',
    })
  })

  it('preserves exact input provenance on transformed output', async () => {
    getBoundWorkspaceFileSecretProvenanceMock.mockResolvedValue(TRACKED)

    const result = await ffmpegServerTool.execute(
      {
        operation: 'convert',
        inputs: { files: [{ path: 'files/input.mp4' }] },
        outputs: { files: [{ path: 'files/converted.mp4' }] },
      },
      context
    )

    expect(result.success).toBe(true)
    expect(writeWorkspaceFileByPathMock).toHaveBeenCalledWith(
      expect.objectContaining({ secretProvenance: TRACKED })
    )
  })

  it('preserves unknown input provenance without blocking the trusted local transform', async () => {
    getBoundWorkspaceFileSecretProvenanceMock.mockResolvedValue({ status: 'unknown' })

    const result = await ffmpegServerTool.execute(
      { operation: 'convert', inputs: { files: [{ path: 'files/input.mp4' }] } },
      context
    )

    expect(result.success).toBe(true)
    expect(fetchWorkspaceFileBufferMock).toHaveBeenCalledWith(file)
    expect(runFfmpegOperationMock).toHaveBeenCalled()
    expect(writeWorkspaceFileByPathMock).toHaveBeenCalledWith(
      expect.objectContaining({ secretProvenance: { status: 'unknown' } })
    )
  })

  it('adds resolved caption provenance to add_text outputs', async () => {
    createWorkspaceFileSecretProvenanceFromRegistryMock.mockResolvedValue({
      safe: true,
      provenance: TEXT_PROVENANCE,
    })

    const result = await ffmpegServerTool.execute(
      {
        operation: 'add_text',
        inputs: { files: [{ path: 'files/input.mp4' }] },
        text: 'private caption',
      },
      context
    )

    expect(result.success).toBe(true)
    expect(createWorkspaceFileSecretProvenanceFromRegistryMock).toHaveBeenCalledWith(
      registry,
      'private caption',
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    expect(writeWorkspaceFileByPathMock).toHaveBeenCalledWith(
      expect.objectContaining({ secretProvenance: TEXT_PROVENANCE })
    )
  })

  it('does not taint operations that ignore the text parameter', async () => {
    const result = await ffmpegServerTool.execute(
      {
        operation: 'convert',
        inputs: { files: [{ path: 'files/input.mp4' }] },
        text: 'ignored caption',
      },
      context
    )

    expect(result.success).toBe(true)
    expect(createWorkspaceFileSecretProvenanceFromRegistryMock).not.toHaveBeenCalled()
    expect(writeWorkspaceFileByPathMock).toHaveBeenCalledWith(
      expect.objectContaining({ secretProvenance: EXACT_EMPTY })
    )
  })

  it('probes tracked inputs without writing an unclassified output file', async () => {
    getBoundWorkspaceFileSecretProvenanceMock.mockResolvedValue(TRACKED)
    runFfmpegOperationMock.mockResolvedValue({
      probe: {
        durationSeconds: 1,
        format: 'mov,mp4',
        hasAudio: true,
        hasVideo: true,
      },
    })

    const result = await ffmpegServerTool.execute(
      { operation: 'probe', inputs: { files: [{ path: 'files/input.mp4' }] } },
      context
    )

    expect(result.success).toBe(true)
    expect(writeWorkspaceFileByPathMock).not.toHaveBeenCalled()
  })

  it('does not expose parser errors from tracked or unknown media bytes', async () => {
    getBoundWorkspaceFileSecretProvenanceMock.mockResolvedValue(TRACKED)
    runFfmpegOperationMock.mockRejectedValue(new Error('decoder echoed private bytes'))

    const result = await ffmpegServerTool.execute(
      { operation: 'convert', inputs: { files: [{ path: 'files/input.mp4' }] } },
      context
    )

    expect(result).toEqual({
      success: false,
      message: 'ffmpeg convert failed: The media operation failed safely',
    })
  })

  it('does not expose storage errors after learning that an input has tracked provenance', async () => {
    getBoundWorkspaceFileSecretProvenanceMock.mockResolvedValue(TRACKED)
    fetchWorkspaceFileBufferMock.mockRejectedValue(new Error('storage echoed private bytes'))

    const result = await ffmpegServerTool.execute(
      { operation: 'convert', inputs: { files: [{ path: 'files/input.mp4' }] } },
      context
    )

    expect(result).toEqual({
      success: false,
      message: 'ffmpeg convert failed: The media operation failed safely',
    })
    expect(runFfmpegOperationMock).not.toHaveBeenCalled()
  })

  it('projects dynamic parser errors before returning them', async () => {
    const secret = 'decoder-secret'
    const errorRegistry = new ResolvedSecretTraceRegistry([
      { name: 'DECODER_SECRET', plaintext: secret, encryptedValue: 'encrypted-decoder-secret' },
    ])
    errorRegistry.recordResolved('DECODER_SECRET', secret)
    runFfmpegOperationMock.mockRejectedValue(new Error(`decoder failed near ${secret}`))

    const result = await ffmpegServerTool.execute(
      { operation: 'convert', inputs: { files: [{ path: 'files/input.mp4' }] } },
      { ...context, resolvedSecretTraceRegistry: errorRegistry }
    )

    expect(result).toEqual({
      success: false,
      message: 'ffmpeg convert failed: decoder failed near {{DECODER_SECRET}}',
    })
  })

  it('uses the fixed safe message directly when no dynamic error text exists', async () => {
    const errorRegistry = new ResolvedSecretTraceRegistry([
      { name: 'T_SECRET', plaintext: 'T', encryptedValue: 'encrypted-t' },
    ])
    errorRegistry.recordResolved('T_SECRET', 'T')
    runFfmpegOperationMock.mockRejectedValue(new Error(''))

    const result = await ffmpegServerTool.execute(
      { operation: 'convert', inputs: { files: [{ path: 'files/input.mp4' }] } },
      { ...context, resolvedSecretTraceRegistry: errorRegistry }
    )

    expect(result).toEqual({
      success: false,
      message: 'ffmpeg convert failed: The media operation failed safely',
    })
  })
})

describe('ffmpeg server tool input admission', () => {
  const context = {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    toolCallId: 'tool-1',
    copilotToolExecution: true as const,
    resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    }),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resolveWorkspaceFileReferenceMock.mockResolvedValue(file)
    fetchWorkspaceFileBufferMock.mockResolvedValue(Buffer.from('media'))
    getBoundWorkspaceFileSecretProvenanceMock.mockResolvedValue(EXACT_EMPTY)
    mergeWorkspaceFileSecretProvenanceMock.mockImplementation(mergeProvenance)
    runFfmpegOperationMock.mockResolvedValue({
      buffer: Buffer.from('output'),
      ext: 'mp4',
      contentType: 'video/mp4',
    })
    writeWorkspaceFileByPathMock.mockResolvedValue({
      id: 'output-1',
      name: 'converted.mp4',
      vfsPath: 'files/converted.mp4',
      downloadUrl: '/api/files/serve/converted.mp4',
      mode: 'create',
    })
  })

  it('refuses more inputs than one call may transcode, before reading any of them', async () => {
    const files = Array.from({ length: 21 }, () => ({ path: 'files/input.mp4' }))

    const result = await ffmpegServerTool.execute(
      { operation: 'concat', inputs: { files } },
      context
    )

    expect(result.success).toBe(false)
    expect(result.message).toContain('at most 20')
    expect(resolveWorkspaceFileReferenceMock).not.toHaveBeenCalled()
    expect(runFfmpegOperationMock).not.toHaveBeenCalled()
  })

  it('admits a batch at the input ceiling', async () => {
    const files = Array.from({ length: 20 }, () => ({ path: 'files/input.mp4' }))

    const result = await ffmpegServerTool.execute(
      { operation: 'concat', inputs: { files } },
      context
    )

    expect(result.success).toBe(true)
    expect(runFfmpegOperationMock).toHaveBeenCalledTimes(1)
  })

  it('rejects on the recorded size before spending the download', async () => {
    resolveWorkspaceFileReferenceMock.mockResolvedValue({ ...file, size: 300 * 1024 * 1024 })

    const result = await ffmpegServerTool.execute(
      { operation: 'convert', inputs: { files: [{ path: 'files/huge.mp4' }] } },
      context
    )

    expect(result.success).toBe(false)
    expect(result.message).toContain('byte limit')
    expect(fetchWorkspaceFileBufferMock).not.toHaveBeenCalled()
  })

  it('stops preparing inputs the moment the caller cancels', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await ffmpegServerTool.execute(
      {
        operation: 'concat',
        inputs: { files: [{ path: 'files/a.mp4' }, { path: 'files/b.mp4' }] },
      },
      { ...context, abortSignal: controller.signal }
    )

    expect(result.success).toBe(false)
    // Not one storage read, let alone all of them.
    expect(resolveWorkspaceFileReferenceMock).not.toHaveBeenCalled()
    expect(fetchWorkspaceFileBufferMock).not.toHaveBeenCalled()
    expect(runFfmpegOperationMock).not.toHaveBeenCalled()
  })

  it('stops between inputs when the cancel lands mid-preparation', async () => {
    const controller = new AbortController()
    // Abort once the first input has been read, so the second is never fetched.
    fetchWorkspaceFileBufferMock.mockImplementationOnce(async () => {
      controller.abort()
      return Buffer.from('media')
    })

    const result = await ffmpegServerTool.execute(
      {
        operation: 'concat',
        inputs: { files: [{ path: 'files/a.mp4' }, { path: 'files/b.mp4' }] },
      },
      { ...context, abortSignal: controller.signal }
    )

    expect(result.success).toBe(false)
    expect(fetchWorkspaceFileBufferMock).toHaveBeenCalledTimes(1)
    expect(runFfmpegOperationMock).not.toHaveBeenCalled()
  })

  it('hands the caller cancellation signal to the transcode', async () => {
    const controller = new AbortController()

    await ffmpegServerTool.execute(
      { operation: 'convert', inputs: { files: [{ path: 'files/input.mp4' }] } },
      { ...context, abortSignal: controller.signal }
    )

    expect(runFfmpegOperationMock).toHaveBeenCalledWith(
      'convert',
      expect.anything(),
      expect.anything(),
      { signal: controller.signal }
    )
  })
})
