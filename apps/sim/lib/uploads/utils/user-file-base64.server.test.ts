/**
 * @vitest-environment node
 */
import { redisConfigMockFns, resetRedisConfigMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocCompileUserError } from '@/lib/copilot/tools/server/files/doc-compile'
import {
  cleanupExecutionBase64Cache,
  hydrateUserFilesWithBase64,
} from '@/lib/uploads/utils/user-file-base64.server'
import type { UserFile } from '@/executor/types'

const { mockDownloadFile, mockRedis, mockVerifyFileAccess } = vi.hoisted(() => {
  const mockRedis = {
    get: vi.fn(),
    set: vi.fn(),
    hget: vi.fn(),
    hset: vi.fn(),
    hgetall: vi.fn(),
    expire: vi.fn(),
    scan: vi.fn(),
    del: vi.fn(),
    eval: vi.fn(),
  }
  return {
    mockDownloadFile: vi.fn(),
    mockRedis,
    mockVerifyFileAccess: vi.fn(),
  }
})

const mockGetRedisClient = redisConfigMockFns.mockGetRedisClient

afterAll(resetRedisConfigMock)

vi.mock('@/lib/uploads', () => ({
  StorageService: {
    downloadFile: mockDownloadFile,
  },
}))

vi.mock('@/lib/uploads/contexts/execution/execution-file-manager', () => ({
  downloadExecutionFile: mockDownloadFile,
}))

const RENDERED_PDF_BUFFER = Buffer.from('%PDF-1.4 rendered', 'utf8')

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromStorage: mockDownloadFile,
  // Mirrors the real module: resolveBase64 narrows on this class to decide whether a
  // strict caller sees the failure, so omitting it from the mock would break that
  // check rather than exercise it.
  UnrenderableDocumentError: class UnrenderableDocumentError extends Error {
    constructor(fileName: string) {
      super(`File ${fileName} could not be rendered`)
      this.name = 'UnrenderableDocumentError'
    }
  },
  downloadServableFileFromStorage: async (
    file: UserFile,
    requestId: string,
    logger: unknown,
    options: { maxBytes?: number } = {}
  ) => {
    // Mirrors the real resolver: a generation-source marker resolves to compiled
    // bytes instead of the raw download, so tests can prove the swap actually happens.
    if (file.type === 'text/x-python-pdf') {
      return { buffer: RENDERED_PDF_BUFFER, contentType: 'application/pdf' }
    }
    // Mirrors the real resolver throwing when a generated doc's compiled artifact
    // isn't ready yet.
    if (file.type === 'text/x-still-compiling-test') {
      throw new DocCompileUserError('Document is still being generated')
    }
    return {
      buffer: await mockDownloadFile(file, requestId, logger, options),
      contentType: file.type ?? 'application/octet-stream',
    }
  },
}))

vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: mockVerifyFileAccess,
}))

describe('hydrateUserFilesWithBase64', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRedisClient.mockReturnValue(null)
    mockRedis.get.mockResolvedValue(null)
    mockRedis.set.mockResolvedValue('OK')
    mockRedis.hget.mockResolvedValue(null)
    mockRedis.hset.mockResolvedValue(1)
    mockRedis.hgetall.mockResolvedValue({})
    mockRedis.expire.mockResolvedValue(1)
    mockRedis.scan.mockResolvedValue(['0', []])
    mockRedis.del.mockResolvedValue(1)
    mockRedis.eval.mockResolvedValue([1, 'ok', 0, 0])
    mockVerifyFileAccess.mockResolvedValue(true)
  })

  it('strips existing base64 when it exceeds maxBytes', async () => {
    const file: UserFile = {
      id: 'file-1',
      name: 'large.txt',
      key: 'execution/workspace/workflow/execution/large.txt',
      url: 'https://example.com/large.txt',
      size: 5,
      type: 'text/plain',
      context: 'execution',
      base64: Buffer.from('hello').toString('base64'),
    }

    const hydrated = await hydrateUserFilesWithBase64({ file }, { maxBytes: 1 })

    expect(hydrated.file).not.toHaveProperty('base64')
  })

  it('keeps existing base64 when it is within maxBytes', async () => {
    const base64 = Buffer.from('hello').toString('base64')
    const file: UserFile = {
      id: 'file-1',
      name: 'small.txt',
      key: 'execution/workspace/workflow/execution/small.txt',
      url: 'https://example.com/small.txt',
      size: 5,
      type: 'text/plain',
      context: 'execution',
      base64,
    }

    const hydrated = await hydrateUserFilesWithBase64({ file }, { maxBytes: 10 })

    expect(hydrated.file.base64).toBe(base64)
  })

  it('does not hydrate URL-only internal file objects', async () => {
    const file: UserFile = {
      id: 'file-1',
      name: 'private.txt',
      key: '',
      url: '/api/files/serve/execution/workspace/workflow/execution/private.txt?context=execution',
      size: 5,
      type: 'text/plain',
    }

    const hydrated = await hydrateUserFilesWithBase64({ file }, { maxBytes: 10, userId: 'user-1' })

    expect(hydrated.file).not.toHaveProperty('base64')
  })

  it('hydrates prior-execution files when workflow-scoped reads are enabled', async () => {
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('hello', 'utf8'))
    const file: UserFile = {
      id: 'file-1',
      name: 'prior.txt',
      key: 'execution/workspace/workflow/source-execution/prior.txt',
      url: '/api/files/serve/execution/workspace/workflow/source-execution/prior.txt?context=execution',
      size: 5,
      type: 'text/plain',
      context: 'execution',
    }

    const hydrated = await hydrateUserFilesWithBase64(
      { file },
      {
        workspaceId: 'workspace',
        workflowId: 'workflow',
        executionId: 'resume-execution',
        allowLargeValueWorkflowScope: true,
        userId: 'user-1',
        maxBytes: 10,
      }
    )

    expect(hydrated.file.base64).toBe(Buffer.from('hello').toString('base64'))
  })

  it('hydrates a generated-document source marker to its rendered bytes, not the raw source download', async () => {
    const rawSourceBytes = Buffer.from('import fpdf ...', 'utf8')
    const file: UserFile = {
      id: 'file-1',
      name: 'report.pdf',
      key: 'workspace/workspace-1/report.pdf',
      url: '/api/files/serve/workspace/workspace-1/report.pdf?context=workspace',
      size: rawSourceBytes.length,
      type: 'text/x-python-pdf',
    }

    const hydrated = await hydrateUserFilesWithBase64(
      { file },
      { userId: 'user-1', maxBytes: 10_000 }
    )

    expect(hydrated.file.base64).toBe(RENDERED_PDF_BUFFER.toString('base64'))
    expect(hydrated.file.base64).not.toBe(rawSourceBytes.toString('base64'))
    expect(mockDownloadFile).not.toHaveBeenCalled()
  })

  function stillCompilingFile(): UserFile {
    return {
      id: 'file-1',
      name: 'report.pdf',
      key: 'workspace/workspace-1/report.pdf',
      url: '/api/files/serve/workspace/workspace-1/report.pdf?context=workspace',
      size: 20,
      type: 'text/x-still-compiling-test',
    }
  }

  it('propagates DocCompileUserError when the caller asked to fail on a not-ready doc', async () => {
    // Regression test: resolveBase64 used to swallow every readUserFileContent
    // error (including this one) and return null, so a generated doc that's
    // still compiling silently lost its base64 instead of surfacing the
    // "still being generated" signal callers are supposed to retry on.
    await expect(
      hydrateUserFilesWithBase64(
        { file: stillCompilingFile() },
        { userId: 'user-1', maxBytes: 10_000, throwOnDocNotReady: true }
      )
    ).rejects.toThrow(DocCompileUserError)
  })

  it('leaves a not-ready doc unhydrated by default rather than failing the caller', async () => {
    // Output decoration (a finished block's result, the final run response) hydrates
    // through this same helper AFTER the work succeeded. Throwing there would mark
    // completed work failed over a compile that finishes moments later, so the throw
    // is opt-in and the default degrades.
    const hydrated = await hydrateUserFilesWithBase64(
      { file: stillCompilingFile() },
      { userId: 'user-1', maxBytes: 10_000 }
    )

    expect(hydrated.file.base64).toBeUndefined()
  })

  it('materializes large refs before hydrating nested files', async () => {
    const file: UserFile = {
      id: 'file-1',
      name: 'nested.txt',
      key: 'execution/workspace/workflow/source-execution/nested.txt',
      url: '/api/files/serve/execution/workspace/workflow/source-execution/nested.txt?context=execution',
      size: 5,
      type: 'text/plain',
      context: 'execution',
    }
    const ref = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_ABCDEFGHIJKL',
      kind: 'object',
      size: 256,
      key: 'execution/workspace/workflow/source-execution/large-value-lv_ABCDEFGHIJKL.json',
      executionId: 'source-execution',
    }

    mockDownloadFile.mockImplementation(async ({ key }) => {
      if (key.includes('large-value')) {
        return Buffer.from(JSON.stringify({ file }), 'utf8')
      }
      return Buffer.from('hello', 'utf8')
    })

    const hydrated = await hydrateUserFilesWithBase64(
      { ref },
      {
        workspaceId: 'workspace',
        workflowId: 'workflow',
        executionId: 'resume-execution',
        largeValueExecutionIds: ['source-execution'],
        userId: 'user-1',
        maxBytes: 1024,
      }
    )

    expect((hydrated.ref as unknown as { file: UserFile }).file.base64).toBe(
      Buffer.from('hello').toString('base64')
    )
  })

  it('preserves large-value metadata while hydrating visible files when requested', async () => {
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('hello', 'utf8'))
    const file: UserFile = {
      id: 'file-1',
      name: 'visible.txt',
      key: 'execution/workspace/workflow/execution-1/visible.txt',
      url: '/api/files/serve/execution/workspace/workflow/execution-1/visible.txt?context=execution',
      size: 5,
      type: 'text/plain',
      context: 'execution',
    }
    const ref = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_PRESERVEREF1',
      kind: 'object',
      size: 256,
      key: 'execution/workspace/workflow/source-execution/large-value-lv_PRESERVEREF1.json',
      executionId: 'source-execution',
    }
    const manifest = {
      __simLargeArrayManifest: true,
      version: 2,
      kind: 'array',
      totalCount: 1,
      chunkCount: 1,
      byteSize: 256,
      chunks: [
        {
          ref,
          count: 1,
          byteSize: 256,
        },
      ],
      preview: [{ id: 1 }],
    }

    const hydrated = await hydrateUserFilesWithBase64(
      { file, ref, manifest },
      {
        workspaceId: 'workspace',
        workflowId: 'workflow',
        executionId: 'execution-1',
        userId: 'user-1',
        maxBytes: 1024,
        preserveLargeValueMetadata: true,
      }
    )

    expect(hydrated.file.base64).toBe(Buffer.from('hello').toString('base64'))
    expect(hydrated.ref).toBe(ref)
    expect(hydrated.manifest).toBe(manifest)
    expect(mockDownloadFile).toHaveBeenCalledOnce()
  })

  it('hydrates nested prior-execution files discovered from exact-key large refs', async () => {
    const file: UserFile = {
      id: 'file-1',
      name: 'nested.txt',
      key: 'execution/workspace/workflow/source-execution/nested.txt',
      url: '/api/files/serve/execution/workspace/workflow/source-execution/nested.txt?context=execution',
      size: 5,
      type: 'text/plain',
      context: 'execution',
    }
    const ref = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_MNOPQRSTUVWX',
      kind: 'object',
      size: 256,
      key: 'execution/workspace/workflow/source-execution/large-value-lv_MNOPQRSTUVWX.json',
      executionId: 'source-execution',
    }

    mockDownloadFile.mockImplementation(async ({ key }) => {
      if (key.includes('large-value')) {
        return Buffer.from(JSON.stringify({ file }), 'utf8')
      }
      return Buffer.from('hello', 'utf8')
    })

    const hydrated = await hydrateUserFilesWithBase64(
      { ref },
      {
        workspaceId: 'workspace',
        workflowId: 'workflow',
        executionId: 'resume-execution',
        largeValueKeys: [ref.key],
        userId: 'user-1',
        maxBytes: 1024,
      }
    )

    expect((hydrated.ref as unknown as { file: UserFile }).file.base64).toBe(
      Buffer.from('hello').toString('base64')
    )
  })

  it('releases reserved Redis budget when cleaning up execution cache entries', async () => {
    mockGetRedisClient.mockReturnValue(mockRedis)
    const rawEntry = JSON.stringify({ bytes: 12, userId: 'user-1' })
    mockRedis.hgetall.mockResolvedValueOnce({
      'key:file-1': rawEntry,
    })
    mockRedis.eval.mockImplementation(async (script: string, ...args: unknown[]) => {
      if (script.includes('HGET') && script.includes('HDEL') && script.includes('DECRBY')) {
        expect(args).toEqual([
          4,
          'user-file:base64-budget:exec:exec-1',
          'user-file:base64:exec:exec-1:key:file-1',
          'execution:redis-budget:execution:exec-1',
          'execution:redis-budget:user:user-1',
          'key:file-1',
          rawEntry,
          12,
          60 * 60,
        ])
        return [1, 1]
      }
      return 1
    })

    await cleanupExecutionBase64Cache('exec-1')

    expect(mockRedis.eval).toHaveBeenCalledOnce()
  })

  it('releases indexed budget entries even when cache keys already expired', async () => {
    mockGetRedisClient.mockReturnValue(mockRedis)
    mockRedis.hgetall.mockResolvedValueOnce({
      'key:file-1': JSON.stringify({ bytes: 7, userId: 'user-1' }),
    })
    mockRedis.eval.mockResolvedValueOnce([1, 0])

    await cleanupExecutionBase64Cache('exec-1')

    expect(mockRedis.eval).toHaveBeenCalledOnce()
  })

  it('writes execution cache and budget index through one delta-aware script', async () => {
    mockGetRedisClient.mockReturnValue(mockRedis)
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('hello world!', 'utf8'))
    let reservedBytes = 0
    mockRedis.eval.mockImplementation(async (script: string, ...args: unknown[]) => {
      if (script.includes('HGET') && script.includes('HSET') && script.includes('SET')) {
        const keyCount = Number(args[0])
        const valueBytes = Number(args[keyCount + 5])
        reservedBytes = valueBytes - 10
        return [1, 'ok', reservedBytes, reservedBytes]
      }
      return 1
    })
    const file: UserFile = {
      id: 'file-1',
      name: 'delta.txt',
      key: 'execution/workspace/workflow/exec-1/delta.txt',
      url: '/api/files/serve/execution/workspace/workflow/exec-1/delta.txt?context=execution',
      size: 12,
      type: 'text/plain',
      context: 'execution',
    }

    const hydrated = await hydrateUserFilesWithBase64(
      { file },
      {
        workspaceId: 'workspace',
        workflowId: 'workflow',
        executionId: 'exec-1',
        userId: 'user-1',
        maxBytes: 20,
      }
    )

    expect(hydrated.file.base64).toBe(Buffer.from('hello world!').toString('base64'))
    expect(reservedBytes).toBe(Buffer.from('hello world!').toString('base64').length - 10)
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('HGET'),
      4,
      'user-file:base64:exec:exec-1:key:execution/workspace/workflow/exec-1/delta.txt',
      'user-file:base64-budget:exec:exec-1',
      'execution:redis-budget:execution:exec-1',
      'execution:redis-budget:user:user-1',
      Buffer.from('hello world!').toString('base64'),
      60 * 60,
      'key:execution/workspace/workflow/exec-1/delta.txt',
      JSON.stringify({
        bytes: Buffer.from('hello world!').toString('base64').length,
        userId: 'user-1',
      }),
      Buffer.from('hello world!').toString('base64').length,
      64 * 1024 * 1024,
      256 * 1024 * 1024,
      60 * 60
    )
    expect(mockRedis.hget).not.toHaveBeenCalled()
    expect(mockRedis.set).not.toHaveBeenCalled()
  })
})
