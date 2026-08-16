/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDownloadFile, mockParseWorkspaceFileKey, mockResolveServableDocBytes } = vi.hoisted(
  () => ({
    mockDownloadFile: vi.fn(),
    mockParseWorkspaceFileKey: vi.fn(),
    mockResolveServableDocBytes: vi.fn(),
  })
)

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFile: mockDownloadFile,
  hasCloudStorage: vi.fn(() => true),
}))

vi.mock('@/lib/uploads/contexts/execution/execution-file-manager', () => ({
  downloadExecutionFile: mockDownloadFile,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  parseWorkspaceFileKey: mockParseWorkspaceFileKey,
}))

vi.mock('@/lib/copilot/tools/server/files/doc-compile', () => ({
  resolveServableDocBytes: mockResolveServableDocBytes,
}))

vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: vi.fn(),
}))

import { createLogger } from '@sim/logger'
import {
  downloadFileFromStorage,
  downloadServableFileFromStorage,
} from '@/lib/uploads/utils/file-utils.server'
import type { UserFile } from '@/executor/types'

describe('downloadFileFromStorage context derivation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDownloadFile.mockResolvedValue(Buffer.from('bytes'))
    mockParseWorkspaceFileKey.mockReturnValue(null)
    mockResolveServableDocBytes.mockImplementation(async ({ rawBuffer }) => ({
      buffer: rawBuffer,
      contentType: 'application/pdf',
    }))
  })

  it('downloads with the key-derived context, ignoring a caller-supplied public context', async () => {
    const userFile: UserFile = {
      id: 'f1',
      name: 'report.pdf',
      url: '',
      size: 5,
      type: 'application/pdf',
      key: 'workspace/ws-1/1700000000000-abc1234-report.pdf',
      context: 'og-images',
    }

    await downloadFileFromStorage(userFile, 'req-1', createLogger('test'))

    expect(mockDownloadFile).toHaveBeenCalledTimes(1)
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.objectContaining({ key: userFile.key, context: 'workspace' })
    )
  })

  it('uses the workspace ID embedded in an execution key to resolve generated artifacts', async () => {
    const workspaceId = '2f1d8c3e-5b6a-4c7d-8e9f-0a1b2c3d4e5f'
    const userFile: UserFile = {
      id: 'f1',
      name: 'report.pdf',
      url: '',
      size: 5,
      type: 'text/x-python-pdf',
      key: `execution/${workspaceId}/3f2e9d4c-6a7b-4d8e-9f0a-1b2c3d4e5f6a/4a3b2c1d-7e8f-4a9b-8c0d-1e2f3a4b5c6d/report.pdf`,
      context: 'execution',
    }

    const filePrincipal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
    await downloadServableFileFromStorage(userFile, 'req-1', createLogger('test'), {
      filePrincipal,
    })

    expect(mockResolveServableDocBytes).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId, filePrincipal })
    )
  })
})
