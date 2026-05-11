/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hydrateUserFilesWithBase64 } from '@/lib/uploads/utils/user-file-base64.server'
import type { UserFile } from '@/executor/types'

const { mockDownloadFile, mockVerifyFileAccess } = vi.hoisted(() => ({
  mockDownloadFile: vi.fn(),
  mockVerifyFileAccess: vi.fn(),
}))

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: () => null,
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
})
