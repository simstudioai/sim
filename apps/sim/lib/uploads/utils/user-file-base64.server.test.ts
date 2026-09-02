/**
 * @vitest-environment node
 */
import { redisConfigMockFns, resetRedisConfigMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupExecutionBase64Cache,
  hydrateUserFilesWithBase64,
} from '@/lib/uploads/utils/user-file-base64.server'
import type { UserFile } from '@/executor/types'

const {
  mockDownloadFile,
  mockDownloadServableFileFromStorage,
  mockRedis,
  mockVerifyFileAccess,
  mockResolveKnowledgeAccessScope,
} = vi.hoisted(() => {
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
    mockDownloadServableFileFromStorage: vi.fn(),
    mockRedis,
    mockVerifyFileAccess: vi.fn(),
    mockResolveKnowledgeAccessScope: vi.fn(),
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

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromStorage: mockDownloadFile,
  downloadServableFileFromStorage: mockDownloadServableFileFromStorage,
}))

vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: mockVerifyFileAccess,
}))

vi.mock('@/lib/knowledge/access/scope', () => ({
  resolveKnowledgeAccessScope: mockResolveKnowledgeAccessScope,
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
    mockDownloadServableFileFromStorage.mockImplementation(async (file: unknown) => ({
      buffer: await mockDownloadFile(file),
      contentType: 'application/octet-stream',
    }))
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

  it('uses rendered size when generated source metadata exceeds the inline limit', async () => {
    const rendered = Buffer.from('%PDF')
    mockDownloadServableFileFromStorage.mockResolvedValueOnce({
      buffer: rendered,
      contentType: 'application/pdf',
    })
    const file: UserFile = {
      id: 'file-1',
      name: 'report.pdf',
      key: 'workspace/2f1d8c3e-5b6a-4c7d-8e9f-0a1b2c3d4e5f/report.pdf',
      url: '',
      size: 11,
      type: 'text/x-python-pdf',
    }

    const hydrated = await hydrateUserFilesWithBase64({ file }, { maxBytes: 10, userId: 'user-1' })

    expect(hydrated.file.base64).toBe(rendered.toString('base64'))
    expect(hydrated.file.size).toBe(rendered.length)
  })

  it('records rendered size when a generated document must use a provider upload path', async () => {
    mockDownloadServableFileFromStorage.mockResolvedValueOnce({
      buffer: Buffer.alloc(11),
      contentType: 'application/pdf',
    })
    const file: UserFile = {
      id: 'file-1',
      name: 'report.pdf',
      key: 'workspace/2f1d8c3e-5b6a-4c7d-8e9f-0a1b2c3d4e5f/report.pdf',
      url: '',
      size: 1,
      type: 'text/x-python-pdf',
    }

    const hydrated = await hydrateUserFilesWithBase64({ file }, { maxBytes: 10, userId: 'user-1' })

    expect(hydrated.file).not.toHaveProperty('base64')
    expect(hydrated.file.size).toBe(11)
  })

  it('records cached rendered size when a generated document must use a provider upload path', async () => {
    mockGetRedisClient.mockReturnValue(mockRedis)
    mockRedis.get.mockResolvedValueOnce(Buffer.alloc(11).toString('base64'))
    const file: UserFile = {
      id: 'file-1',
      name: 'report.pdf',
      key: 'workspace/2f1d8c3e-5b6a-4c7d-8e9f-0a1b2c3d4e5f/report.pdf',
      url: '',
      size: 1,
      type: 'text/x-python-pdf',
    }

    const hydrated = await hydrateUserFilesWithBase64({ file }, { maxBytes: 10, userId: 'user-1' })

    expect(hydrated.file).not.toHaveProperty('base64')
    expect(hydrated.file.size).toBe(11)
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
  })

  it('bypasses a byte-only cache when model hydration must verify document contributors', async () => {
    mockGetRedisClient.mockReturnValue(mockRedis)
    mockRedis.get.mockResolvedValue(Buffer.from('%PDF-cached').toString('base64'))
    const contentUpdatedAt = new Date('2026-08-06T00:00:00.000Z')
    const contributor = {
      fileId: 'image-1',
      key: 'workspace/workspace-1/image-1.png',
      context: 'workspace' as const,
      contentUpdatedAt,
    }
    mockDownloadServableFileFromStorage.mockResolvedValueOnce({
      buffer: Buffer.from('%PDF-current'),
      contentType: 'application/pdf',
      contributingFiles: [contributor],
    })
    const onServableFileContributors = vi.fn().mockResolvedValue(undefined)
    const file: UserFile = {
      id: 'file-1',
      name: 'report.pdf',
      key: 'workspace/workspace-1/report.pdf',
      url: '',
      size: 1,
      type: 'text/x-python-pdf',
    }

    const hydrated = await hydrateUserFilesWithBase64(
      { file },
      {
        maxBytes: 100,
        userId: 'user-1',
        onServableFileContributors,
      }
    )

    expect(mockRedis.get).not.toHaveBeenCalled()
    expect(hydrated.file.base64).toBe(Buffer.from('%PDF-current').toString('base64'))
    expect(onServableFileContributors).toHaveBeenCalledWith(file, [contributor])
  })

  it('propagates generated documents that are still compiling', async () => {
    const notReady = new Error('Document is still being generated')
    notReady.name = 'DocCompileUserError'
    mockDownloadServableFileFromStorage.mockRejectedValueOnce(notReady)
    const file: UserFile = {
      id: 'file-1',
      name: 'report.pdf',
      key: 'workspace/2f1d8c3e-5b6a-4c7d-8e9f-0a1b2c3d4e5f/report.pdf',
      url: '',
      size: 1,
      type: 'text/x-python-pdf',
    }

    await expect(
      hydrateUserFilesWithBase64({ file }, { maxBytes: 10, userId: 'user-1' })
    ).rejects.toBe(notReady)
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

  it('reads a knowledge-base file as the principal behind the run', async () => {
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('hello', 'utf8'))
    const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
    const scope = { kind: 'user' as const, tokens: ['user:user-1'] }
    mockResolveKnowledgeAccessScope.mockResolvedValue(scope)
    const file: UserFile = {
      id: 'file-1',
      name: 'shared.txt',
      key: 'kb/workspace/shared.txt',
      url: '/api/files/serve/kb/workspace/shared.txt?context=knowledge-base',
      size: 5,
      type: 'text/plain',
      context: 'knowledge-base',
    }

    const hydrated = await hydrateUserFilesWithBase64(
      { file },
      {
        workspaceId: 'workspace',
        workflowId: 'workflow',
        userId: 'user-1',
        principal,
        maxBytes: 10,
      }
    )

    expect(hydrated.file.base64).toBe(Buffer.from('hello').toString('base64'))
    expect(mockResolveKnowledgeAccessScope).toHaveBeenCalledWith(principal, {
      workspaceId: 'workspace',
    })
    expect(mockVerifyFileAccess).toHaveBeenCalledWith(
      file.key,
      'user-1',
      undefined,
      'knowledge-base',
      false,
      { knowledgeAccess: scope }
    )
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

  /**
   * Reproduces the agent-attachment failure: a file under the inline limit whose base64 exceeds
   * the 8 MiB single-Redis-write cap. The bytes are already read by the time the cache is
   * written, so a refused cache write must degrade to "not cached", not fail the execution.
   */
  it('still returns base64 when the value is too large to cache', async () => {
    mockGetRedisClient.mockReturnValue(mockRedis)
    const buffer = Buffer.alloc(9 * 1024 * 1024, 0x61)
    mockDownloadFile.mockResolvedValueOnce(buffer)
    const file: UserFile = {
      id: 'file-1',
      name: 'data_10mb.csv',
      key: 'execution/workspace/workflow/exec-1/data_10mb.csv',
      url: 'https://example.com/data_10mb.csv',
      size: buffer.length,
      type: 'text/csv',
      context: 'execution',
    }

    const hydrated = await hydrateUserFilesWithBase64(
      { file },
      {
        workspaceId: 'workspace',
        workflowId: 'workflow',
        executionId: 'exec-1',
        userId: 'user-1',
        maxBytes: 10 * 1024 * 1024,
      }
    )

    expect(hydrated.file.base64).toBe(buffer.toString('base64'))
    expect(mockRedis.eval).not.toHaveBeenCalled()
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
