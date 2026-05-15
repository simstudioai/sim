/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cacheLargeValue,
  clearLargeValueCacheForTests,
  materializeLargeValueRefSync,
} from '@/lib/execution/payloads/cache'
import {
  MAX_DURABLE_LARGE_VALUE_BYTES,
  readLargeValueRefFromStorage,
  readUserFileContent,
} from '@/lib/execution/payloads/materialization.server'
import { materializeLargeValueRef, storeLargeValue } from '@/lib/execution/payloads/store'
import { EXECUTION_RESOURCE_LIMIT_CODE } from '@/lib/execution/resource-errors'

const { mockDownloadFile, mockUploadFile, mockVerifyFileAccess } = vi.hoisted(() => ({
  mockDownloadFile: vi.fn(),
  mockUploadFile: vi.fn(),
  mockVerifyFileAccess: vi.fn(),
}))

vi.mock('@/lib/uploads', () => ({
  StorageService: {
    uploadFile: mockUploadFile,
    downloadFile: mockDownloadFile,
  },
}))

vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: mockVerifyFileAccess,
}))

describe('large execution payload store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLargeValueCacheForTests()
    mockUploadFile.mockImplementation(async ({ customKey }) => ({ key: customKey }))
    mockVerifyFileAccess.mockResolvedValue(true)
  })

  it('stores oversized JSON in execution object storage and returns a small ref', async () => {
    const value = { payload: 'x'.repeat(2048) }
    const json = JSON.stringify(value)

    const ref = await storeLargeValue(value, json, Buffer.byteLength(json, 'utf8'), {
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      userId: 'user-1',
      requireDurable: true,
    })

    expect(ref).toMatchObject({
      __simLargeValueRef: true,
      version: 1,
      kind: 'object',
      size: Buffer.byteLength(json, 'utf8'),
      executionId: 'execution-1',
    })
    expect(ref.key).toBe(`execution/workspace-1/workflow-1/execution-1/large-value-${ref.id}.json`)
    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'application/json',
        context: 'execution',
        preserveKey: true,
        customKey: ref.key,
      })
    )
  })

  it('fails durable writes before producing refs when execution context is missing', async () => {
    const value = { payload: 'x'.repeat(2048) }
    const json = JSON.stringify(value)

    await expect(
      storeLargeValue(value, json, Buffer.byteLength(json, 'utf8'), { requireDurable: true })
    ).rejects.toThrow('Cannot persist large execution value')

    expect(mockUploadFile).not.toHaveBeenCalled()
  })

  it('fails durable writes when storage upload fails', async () => {
    const value = { payload: 'x'.repeat(2048) }
    const json = JSON.stringify(value)
    mockUploadFile.mockRejectedValueOnce(new Error('storage down'))

    await expect(
      storeLargeValue(value, json, Buffer.byteLength(json, 'utf8'), {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        requireDurable: true,
      })
    ).rejects.toThrow('Failed to persist large execution value: storage down')
  })

  it('materializes object-storage refs through the server helper', async () => {
    mockDownloadFile.mockResolvedValueOnce(Buffer.from(JSON.stringify({ ok: true }), 'utf8'))

    await expect(
      materializeLargeValueRef(
        {
          __simLargeValueRef: true,
          version: 1,
          id: 'lv_ABCDEFGHIJKL',
          kind: 'object',
          size: 11,
          key: 'execution/workflow-1/workflow-2/execution-1/large-value-lv_ABCDEFGHIJKL.json',
          executionId: 'execution-1',
        },
        {
          workspaceId: 'workflow-1',
          workflowId: 'workflow-2',
          executionId: 'execution-1',
        }
      )
    ).resolves.toEqual({ ok: true })
  })

  it('bounds durable large-value writes', async () => {
    const size = MAX_DURABLE_LARGE_VALUE_BYTES + 1

    await expect(
      storeLargeValue('x', JSON.stringify('x'), size, {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        requireDurable: true,
      })
    ).rejects.toMatchObject({ code: EXECUTION_RESOURCE_LIMIT_CODE })
  })

  it('bounds explicit server-side materialization', async () => {
    await expect(
      readLargeValueRefFromStorage(
        {
          __simLargeValueRef: true,
          version: 1,
          id: 'lv_ABCDEFGHIJKL',
          kind: 'object',
          size: 2048,
          key: 'execution/workflow-1/workflow-2/execution-1/large-value-lv_ABCDEFGHIJKL.json',
          executionId: 'execution-1',
        },
        {
          workspaceId: 'workflow-1',
          workflowId: 'workflow-2',
          executionId: 'execution-1',
          maxBytes: 1024,
        }
      )
    ).rejects.toMatchObject({ code: EXECUTION_RESOURCE_LIMIT_CODE })
  })

  it('does not materialize durable refs without caller execution context', async () => {
    await expect(
      materializeLargeValueRef({
        __simLargeValueRef: true,
        version: 1,
        id: 'lv_NOCTXVALUE12',
        kind: 'object',
        size: 11,
        key: 'execution/workflow-1/workflow-2/execution-1/large-value-lv_NOCTXVALUE12.json',
        executionId: 'execution-1',
      })
    ).resolves.toBeUndefined()

    expect(mockDownloadFile).not.toHaveBeenCalled()
  })

  it('checks caller execution context before returning cached large values', async () => {
    const value = { payload: 'cached' }
    const json = JSON.stringify(value)
    const ref = await storeLargeValue(value, json, Buffer.byteLength(json, 'utf8'), {
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      userId: 'user-1',
      requireDurable: true,
    })

    await expect(
      materializeLargeValueRef(ref, {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'other-execution',
        userId: 'user-1',
      })
    ).rejects.toThrow('Large execution value is not available in this execution.')
  })

  it('rejects durable refs whose key does not match caller execution context', async () => {
    await expect(
      readLargeValueRefFromStorage(
        {
          __simLargeValueRef: true,
          version: 1,
          id: 'lv_ABCDEFGHIJKL',
          kind: 'object',
          size: 11,
          key: 'execution/workflow-1/workflow-2/execution-1/large-value-lv_ABCDEFGHIJKL.json',
          executionId: 'execution-1',
        },
        { workspaceId: 'workflow-1', workflowId: 'workflow-2', executionId: 'other-execution' }
      )
    ).rejects.toThrow('Large execution value is not available in this execution.')

    expect(mockDownloadFile).not.toHaveBeenCalled()
  })

  it('allows prior-execution durable refs only when workflow-scoped reads are explicitly enabled', async () => {
    mockDownloadFile.mockResolvedValueOnce(Buffer.from(JSON.stringify({ ok: true }), 'utf8'))

    await expect(
      readLargeValueRefFromStorage(
        {
          __simLargeValueRef: true,
          version: 1,
          id: 'lv_ABCDEFGHIJKL',
          kind: 'object',
          size: 11,
          key: 'execution/workspace-1/workflow-1/source-execution/large-value-lv_ABCDEFGHIJKL.json',
          executionId: 'source-execution',
        },
        {
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          executionId: 'resume-execution',
          allowLargeValueWorkflowScope: true,
        }
      )
    ).resolves.toEqual({ ok: true })
  })

  it('does not materialize forged keyless refs from another cached execution', () => {
    cacheLargeValue('lv_FORGEDCACHE1', { secret: true }, 16, {
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'source-execution',
    })

    const forged = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_FORGEDCACHE1',
      kind: 'object',
      size: 16,
      executionId: 'other-execution',
    } as const

    expect(
      materializeLargeValueRefSync(forged, {
        workspaceId: 'workspace-2',
        workflowId: 'workflow-2',
        executionId: 'other-execution',
      })
    ).toBeUndefined()
  })

  it('does not evict unrecoverable in-memory refs for recoverable cache entries', () => {
    const scope = {
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    }
    const unrecoverableId = 'lv_UNRECOVER001'
    const unrecoverableRef = {
      __simLargeValueRef: true,
      version: 1,
      id: unrecoverableId,
      kind: 'object',
      size: 200 * 1024 * 1024,
      executionId: scope.executionId,
    } as const

    expect(cacheLargeValue(unrecoverableId, { retained: true }, unrecoverableRef.size, scope)).toBe(
      true
    )
    expect(
      cacheLargeValue('lv_RECOVER00001', { recoverable: true }, 70 * 1024 * 1024, scope, {
        recoverable: true,
      })
    ).toBe(false)
    expect(materializeLargeValueRefSync(unrecoverableRef, scope)).toEqual({ retained: true })
  })

  it('materializes keyless cached refs through the async helper', async () => {
    const scope = {
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    }
    const ref = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_KEYLESSCACHE',
      kind: 'object',
      size: 32,
      executionId: scope.executionId,
    } as const
    cacheLargeValue(ref.id, { retained: true }, ref.size, scope)

    await expect(materializeLargeValueRef(ref, scope)).resolves.toEqual({ retained: true })
    expect(mockDownloadFile).not.toHaveBeenCalled()
  })

  it('enforces maxBytes before returning cached refs', async () => {
    const scope = {
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    }
    const ref = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_CACHEDMAXBYTE',
      kind: 'object',
      size: 2048,
      executionId: scope.executionId,
    } as const
    cacheLargeValue(ref.id, { retained: true }, ref.size, scope)

    await expect(materializeLargeValueRef(ref, { ...scope, maxBytes: 1024 })).rejects.toMatchObject(
      {
        code: EXECUTION_RESOURCE_LIMIT_CODE,
      }
    )
    expect(mockDownloadFile).not.toHaveBeenCalled()
  })

  it('rejects durable refs when caller omits workspace and workflow context', async () => {
    await expect(
      readLargeValueRefFromStorage(
        {
          __simLargeValueRef: true,
          version: 1,
          id: 'lv_ABCDEFGHIJKL',
          kind: 'object',
          size: 11,
          key: 'execution/workflow-1/workflow-2/execution-1/large-value-lv_ABCDEFGHIJKL.json',
          executionId: 'execution-1',
        },
        { executionId: 'execution-1' }
      )
    ).rejects.toThrow('Large execution value requires workspace and workflow context.')

    expect(mockDownloadFile).not.toHaveBeenCalled()
  })

  it('rejects execution files with forged public contexts before storage download', async () => {
    await expect(
      readUserFileContent(
        {
          id: 'file_1',
          name: 'secret.txt',
          url: '/api/files/serve/execution/workspace-1/workflow-1/execution-1/secret.txt',
          key: 'execution/workspace-1/workflow-1/execution-1/secret.txt',
          context: 'profile-pictures',
          size: 32,
          type: 'text/plain',
        },
        {
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          userId: 'user-1',
          encoding: 'text',
        }
      )
    ).rejects.toThrow('File context does not match its storage key.')

    expect(mockVerifyFileAccess).not.toHaveBeenCalled()
    expect(mockDownloadFile).not.toHaveBeenCalled()
  })

  it('rejects URL-only file objects instead of reading internal URLs directly', async () => {
    await expect(
      readUserFileContent(
        {
          id: 'file_1',
          name: 'secret.txt',
          url: '/api/files/serve/execution/workspace-1/workflow-1/execution-1/secret.txt?context=execution',
          key: '',
          size: 32,
          type: 'text/plain',
        },
        {
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          userId: 'user-1',
          encoding: 'text',
        }
      )
    ).rejects.toThrow('File content requires a storage key.')

    expect(mockVerifyFileAccess).not.toHaveBeenCalled()
    expect(mockDownloadFile).not.toHaveBeenCalled()
  })

  it('throws instead of truncating non-chunked file reads over the inline cap', async () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111'
    const workflowId = '22222222-2222-4222-8222-222222222222'
    const executionId = '33333333-3333-4333-8333-333333333333'
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('hello world', 'utf8'))

    await expect(
      readUserFileContent(
        {
          id: 'file_1',
          name: 'hello.txt',
          url: `/api/files/serve/execution/${workspaceId}/${workflowId}/${executionId}/hello.txt`,
          key: `execution/${workspaceId}/${workflowId}/${executionId}/hello.txt`,
          context: 'execution',
          size: 11,
          type: 'text/plain',
        },
        {
          workspaceId,
          workflowId,
          executionId,
          userId: 'user-1',
          encoding: 'text',
          maxBytes: 5,
        }
      )
    ).rejects.toMatchObject({ code: EXECUTION_RESOURCE_LIMIT_CODE })
  })

  it('allows explicit chunked file reads to slice within the inline cap', async () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111'
    const workflowId = '22222222-2222-4222-8222-222222222222'
    const executionId = '33333333-3333-4333-8333-333333333333'
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('hello world', 'utf8'))

    await expect(
      readUserFileContent(
        {
          id: 'file_1',
          name: 'hello.txt',
          url: `/api/files/serve/execution/${workspaceId}/${workflowId}/${executionId}/hello.txt`,
          key: `execution/${workspaceId}/${workflowId}/${executionId}/hello.txt`,
          context: 'execution',
          size: 11,
          type: 'text/plain',
        },
        {
          workspaceId,
          workflowId,
          executionId,
          userId: 'user-1',
          encoding: 'text',
          maxBytes: 5,
          chunked: true,
        }
      )
    ).resolves.toBe('hello')
  })
})
