/** @vitest-environment jsdom */

import { PASTE_LIMITS } from '@sim/utils/paste'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestRaw } from '@/lib/api/client/request'
import { exportWorkspaceFileSnapshotContract } from '@/lib/api/contracts/workspace-files'
import { type FileDownloadSource, triggerFileDownload } from '@/lib/uploads/client/download'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'

vi.mock('@/lib/api/client/request', () => ({ requestRaw: vi.fn() }))

const file: WorkspaceFileRecord = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'document.md',
  key: 'stored-version',
  path: '/document.md',
  type: 'text/markdown',
  size: 4,
  uploadedBy: 'user-1',
  uploadedAt: new Date('2026-01-01T00:00:00Z'),
}

const fetchMock = vi.fn<typeof fetch>()
const createObjectURL = vi.fn((_blob: Blob) => 'blob:download')
const click = vi.fn()
let downloadedName = ''

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = vi.fn()
    }
  )
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    downloadedName = this.download
    click()
  })
  downloadedName = ''
  fetchMock.mockResolvedValue(new Response('stored'))
  vi.mocked(requestRaw).mockResolvedValue(new Response('snapshot'))
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function source(content = 'latest visible content'): FileDownloadSource {
  return { fileId: file.id, workspaceId: file.workspaceId, getContent: vi.fn(() => content) }
}

describe('file download snapshots', () => {
  it('downloads an oversized source draft directly instead of rejecting it or using stale storage', async () => {
    const content = '😀'.repeat(Math.floor(PASTE_LIMITS.RICH_MARKDOWN_BYTES / 4) + 1)
    await triggerFileDownload(file, source(content))
    expect(requestRaw).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    const blob = createObjectURL.mock.calls[0]![0]
    const reader = new FileReader()
    const read = new Promise<string>((resolve) => {
      reader.onload = () => resolve(reader.result as string)
    })
    reader.readAsText(blob)
    await vi.runAllTimersAsync()
    expect(await read).toBe(content)
    expect(downloadedName).toBe(file.name)
    expect(click).toHaveBeenCalledOnce()
  })
  it.each(['latest local and peer text', ''])(
    'captures the mounted content immediately: %j',
    async (content) => {
      const mounted = source(content)
      const pending = Promise.withResolvers<Response>()
      vi.mocked(requestRaw).mockReturnValueOnce(pending.promise)
      const download = triggerFileDownload(file, mounted)
      expect(mounted.getContent).toHaveBeenCalledOnce()
      expect(requestRaw).toHaveBeenCalledExactlyOnceWith(
        exportWorkspaceFileSnapshotContract,
        { params: { id: file.workspaceId, fileId: file.id }, body: { content } },
        { cache: 'no-store' }
      )
      expect(fetchMock).not.toHaveBeenCalled()
      pending.resolve(new Response(content))
      await download
      expect(click).toHaveBeenCalledOnce()
      expect(downloadedName).toBe(file.name)
    }
  )

  it.each([{ fileId: 'another-file' }, { workspaceId: 'another-workspace' }])(
    'does not read another mounted document: %j',
    async (scope) => {
      const mounted = { ...source(), ...scope }
      await triggerFileDownload(file, mounted)
      expect(mounted.getContent).not.toHaveBeenCalled()
      expect(requestRaw).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledWith('/api/files/export/file-1', { cache: 'no-store' })
    }
  )

  it('keeps the stored export for an unmounted viewer', async () => {
    await triggerFileDownload(file)
    expect(requestRaw).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith('/api/files/export/file-1', { cache: 'no-store' })
  })

  it('keeps the stored export while an editor has no displayable content', async () => {
    await triggerFileDownload(file, { ...source(), getContent: () => null })
    expect(requestRaw).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('does not change non-Markdown downloads', async () => {
    const mounted = source()
    await triggerFileDownload({ ...file, name: 'document.txt', type: 'text/plain' }, mounted)
    expect(mounted.getContent).not.toHaveBeenCalled()
    expect(requestRaw).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/files/serve/stored-version'),
      {
        cache: 'no-store',
      }
    )
  })

  it('does not send non-workspace storage to the workspace snapshot endpoint', async () => {
    const mounted = source()
    await triggerFileDownload({ ...file, storageContext: 'mothership' }, mounted)
    expect(mounted.getContent).not.toHaveBeenCalled()
    expect(requestRaw).not.toHaveBeenCalled()
  })

  it('honors the archive filename returned for bundled embedded images', async () => {
    vi.mocked(requestRaw).mockResolvedValueOnce(
      new Response('zip', {
        headers: { 'Content-Disposition': "attachment; filename*=UTF-8''document%20images.zip" },
      })
    )
    await triggerFileDownload(file, source())
    expect(downloadedName).toBe('document images.zip')
  })

  it.each(['Access denied', 'Markdown snapshot is too large'])(
    'does not silently fall back to stale storage after snapshot failure: %s',
    async (message) => {
      vi.mocked(requestRaw).mockRejectedValueOnce(new Error(message))
      await expect(triggerFileDownload(file, source())).rejects.toThrow(message)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(click).not.toHaveBeenCalled()
    }
  )
})
