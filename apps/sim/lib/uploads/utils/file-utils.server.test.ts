import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { filesAuthorizationMock } from '@sim/testing/mocks/files-authorization.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import {
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from '@sim/testing/mocks/workspace-file-manager.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveServableDocBytes, mockRenderPage } = vi.hoisted(() => ({
  mockResolveServableDocBytes: vi.fn(),
  mockRenderPage: vi.fn(),
}))

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

vi.mock('@/lib/uploads/contexts/execution/execution-file-manager', () => ({
  downloadExecutionFile: storageServiceMockFns.mockDownloadFile,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => workspaceFileManagerMock)

vi.mock('@/lib/mothership/tools/server/files/doc-compile', () => ({
  resolveServableDocBytes: mockResolveServableDocBytes,
}))

vi.mock('@/lib/workspace-files/page-document.server', () => ({
  renderSimPageDocumentWithContributors: mockRenderPage,
}))

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)

import { createLogger } from '@sim/logger'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import {
  downloadFileFromStorage,
  downloadServableFileFromStorage,
  downloadServableFilesWithinBudget,
} from '@/lib/uploads/utils/file-utils.server'
import type { UserFile } from '@/executor/types'

const mockParseWorkspaceFileKey = workspaceFileManagerMockFns.mockParseWorkspaceFileKey

const mockDownloadFile = storageServiceMockFns.mockDownloadFile
storageServiceMockFns.mockHasCloudStorage.mockImplementation(() => true)

describe('downloadFileFromStorage context derivation', () => {
  beforeEach(() => {
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

    const filePrincipal = createSessionPrincipal()
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
})

describe('servable page provenance', () => {
  it('preserves the inlined image identity for execution-stored pages', async () => {
    const workspaceId = '2f1d8c3e-5b6a-4c7d-8e9f-0a1b2c3d4e5f'
    const contributor = {
      fileId: 'image-file',
      key: `workspace/${workspaceId}/image.png`,
      context: 'workspace' as const,
      contentUpdatedAt: new Date('2026-01-01T00:00:00Z'),
    }
    mockParseWorkspaceFileKey.mockReturnValue(null)
    mockDownloadFile.mockResolvedValue(Buffer.from('---\ntitle: Example\n---\nPage body'))
    mockRenderPage.mockResolvedValue({
      html: '<html>rendered image</html>',
      contributingFiles: [contributor],
    })

    const rendered = await downloadServableFileFromStorage(
      {
        id: 'page-file',
        name: 'page.html',
        key: `execution/${workspaceId}/3f2e9d4c-6a7b-4d8e-9f0a-1b2c3d4e5f6a/4a3b2c1d-7e8f-4a9b-8c0d-1e2f3a4b5c6d/page.html`,
        url: '',
        type: 'text/x-sim-page',
        size: 100,
        context: 'execution',
      },
      'request',
      createLogger('test'),
      { maxBytes: 1024 }
    )

    expect(mockRenderPage).toHaveBeenCalledWith(expect.any(String), { workspaceId })
    expect(rendered).toEqual({
      buffer: Buffer.from('<html>rendered image</html>'),
      contentType: 'text/html',
      contributingFiles: [contributor],
    })
  })
})
