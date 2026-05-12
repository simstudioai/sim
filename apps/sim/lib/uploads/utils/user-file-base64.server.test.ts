/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupExecutionBase64Cache,
  hydrateUserFilesWithBase64,
} from '@/lib/uploads/utils/user-file-base64.server'
import type { UserFile } from '@/executor/types'

const { mockDownloadFile, mockGetRedisClient, mockRedis, mockVerifyFileAccess } = vi.hoisted(() => {
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
    mockGetRedisClient: vi.fn(),
    mockRedis,
    mockVerifyFileAccess: vi.fn(),
  }
})

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: mockGetRedisClient,
}))

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
