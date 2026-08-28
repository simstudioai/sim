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
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import {
  downloadFileFromStorage,
  downloadServableFileFromStorage,
  downloadServableFilesWithinBudget,
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

    await downloadFileFromStorage(userFile, 'req-1', createLogger('test'), {
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
    })

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
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
      filePrincipal,
    })

    expect(mockResolveServableDocBytes).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId, filePrincipal })
    )
  })
})

describe('downloadFileFromStorage size ceiling', () => {
  const logger = createLogger('test')
  const fileOfSize = (size: number): UserFile => ({
    id: 'f1',
    name: 'clip.wav',
    url: '',
    size,
    type: 'audio/wav',
    key: 'workspace/ws-1/1700000000000-abc1234-clip.wav',
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockParseWorkspaceFileKey.mockReturnValue(null)
  })

  it('rejects on the declared size before moving any bytes', async () => {
    await expect(
      downloadFileFromStorage(fileOfSize(2048), 'req-1', logger, { maxBytes: 1024 })
    ).rejects.toThrow(PayloadSizeLimitError)

    expect(mockDownloadFile).not.toHaveBeenCalled()
  })

  it('rejects on the delivered bytes when the declared size understated them', async () => {
    mockDownloadFile.mockResolvedValue(Buffer.alloc(2048))

    await expect(
      downloadFileFromStorage(fileOfSize(1), 'req-1', logger, { maxBytes: 1024 })
    ).rejects.toThrow(PayloadSizeLimitError)
  })

  it('forwards the ceiling to the storage layer so a provider can stop mid-stream', async () => {
    mockDownloadFile.mockResolvedValue(Buffer.alloc(512))

    await downloadFileFromStorage(fileOfSize(512), 'req-1', logger, { maxBytes: 1024 })

    expect(mockDownloadFile).toHaveBeenCalledWith(expect.objectContaining({ maxBytes: 1024 }))
  })

  it('forwards cancellation to the storage layer', async () => {
    const controller = new AbortController()
    mockDownloadFile.mockResolvedValue(Buffer.alloc(512))

    await downloadFileFromStorage(fileOfSize(512), 'req-1', logger, {
      maxBytes: 1024,
      signal: controller.signal,
    })

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.objectContaining({ maxBytes: 1024, signal: controller.signal })
    )
  })
})

describe('downloadServableFilesWithinBudget', () => {
  const logger = createLogger('test')
  const fileOfSize = (name: string, size: number): UserFile => ({
    id: name,
    name,
    url: '',
    size,
    type: 'application/octet-stream',
    key: `workspace/ws-1/1700000000000-abc1234-${name}`,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockParseWorkspaceFileKey.mockReturnValue(null)
    mockDownloadFile.mockImplementation(async ({ key }) =>
      Buffer.alloc(key.endsWith('big.bin') ? 900 : 400)
    )
  })

  it('spends the budget across the list rather than per file', async () => {
    const resolved = await downloadServableFilesWithinBudget(
      [fileOfSize('a.bin', 400), fileOfSize('b.bin', 400)],
      'req-1',
      logger,
      { totalMaxBytes: 1000, label: 'Total attachment size' }
    )

    expect(resolved.map((r) => r.buffer.length)).toEqual([400, 400])
    // The second file was only offered what the first left behind.
    expect(mockDownloadFile).toHaveBeenNthCalledWith(2, expect.objectContaining({ maxBytes: 600 }))
  })

  it('rejects the combined size even when every file is individually under the limit', async () => {
    const failure = await downloadServableFilesWithinBudget(
      [fileOfSize('a.bin', 400), fileOfSize('b.bin', 400), fileOfSize('c.bin', 400)],
      'req-1',
      logger,
      { totalMaxBytes: 1000, label: 'Total attachment size' }
    ).catch((error) => error)

    // Restated in the caller's terms: the whole set against the whole budget, not the
    // third file against the 200 bytes the first two happened to leave.
    expect(failure).toBeInstanceOf(PayloadSizeLimitError)
    expect(failure).toMatchObject({
      label: 'Total attachment size',
      maxBytes: 1000,
      observedBytes: 1200,
    })

    // The third file's declared size already exceeds what the first two left, so it is
    // refused without fetching its bytes — the whole set is never resident at once.
    expect(mockDownloadFile).toHaveBeenCalledTimes(2)
  })

  it('refuses the next file on its declared size once the budget is spent', async () => {
    await expect(
      downloadServableFilesWithinBudget(
        [fileOfSize('big.bin', 900), fileOfSize('a.bin', 400)],
        'req-1',
        logger,
        { totalMaxBytes: 1000, label: 'Total attachment size' }
      )
    ).rejects.toThrow(PayloadSizeLimitError)

    expect(mockDownloadFile).toHaveBeenCalledTimes(1)
  })
})
