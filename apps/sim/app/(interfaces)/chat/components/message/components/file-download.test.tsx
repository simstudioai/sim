/**
 * @vitest-environment jsdom
 */
import { Blob as NodeBlob } from 'node:buffer'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ChatFileDownload,
  ChatFileDownloadAll,
} from '@/app/(interfaces)/chat/components/message/components/file-download'
import type { ChatFile } from '@/app/(interfaces)/chat/components/message/message'

const imageFile: ChatFile = {
  id: 'file-image',
  name: 'generated.png',
  key: 'execution/generated.png',
  url: 'https://files.example.com/generated.png',
  size: 3,
  type: 'image/png',
  base64: 'YWJj',
}

const fetchMock = vi.fn<typeof fetch>()
const createObjectURL = vi.fn((_blob: Blob) => 'blob:download')
const downloadedNames: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  downloadedNames.length = 0
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = vi.fn()
    }
  )
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    downloadedNames.push(this.download)
  })
  vi.spyOn(window, 'open').mockImplementation(() => null)
})

const mounts: Array<() => void> = []

function renderFile(file: ChatFile | ChatFile[]): HTMLDivElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root = createRoot(container)
  act(() =>
    root.render(
      Array.isArray(file) ? <ChatFileDownloadAll files={file} /> : <ChatFileDownload file={file} />
    )
  )
  mounts.push(() => act(() => root.unmount()))
  return container
}

afterEach(() => {
  while (mounts.length) mounts.pop()?.()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ChatFileDownload', () => {
  it('previews returned image bytes inline without requiring a workspace session', () => {
    const container = renderFile(imageFile)
    const image = container.querySelector('img')
    expect(image?.getAttribute('src')).toBe('data:image/png;base64,YWJj')
    expect(image?.alt).toBe('generated.png')
    expect(container.querySelector('button')?.textContent).toContain('generated.png')
  })

  it('uses the file URL when inline bytes are unavailable', () => {
    const container = renderFile({ ...imageFile, base64: undefined })
    expect(container.querySelector('img')?.getAttribute('src')).toBe(imageFile.url)
  })

  it('uses the canonical serve route for unsafe file URLs', () => {
    const container = renderFile({ ...imageFile, base64: undefined, url: 'javascript:alert(1)' })
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/api/files/serve/execution%2Fgenerated.png?context=execution'
    )
  })

  it('keeps a download available when an image preview fails', () => {
    const container = renderFile(imageFile)
    act(() => container.querySelector('img')!.dispatchEvent(new Event('error')))
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('button')?.textContent).toContain('generated.png')
  })

  it('renders documents as downloads without an image preview', () => {
    const container = renderFile({ ...imageFile, name: 'report.pdf', type: 'application/pdf' })
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('button')?.textContent).toContain('report.pdf')
  })
})

async function clickDownload(container: HTMLDivElement): Promise<void> {
  await act(async () => container.querySelector('button')!.click())
}

describe('chat file downloads', () => {
  it('downloads exact inline bytes without fetching a data URL or needing a session', async () => {
    fetchMock.mockRejectedValue(new TypeError('Blocked by connect-src'))
    const container = renderFile({ ...imageFile, base64: 'AP9/gAE=' })
    await clickDownload(container)
    expect(fetchMock).not.toHaveBeenCalled()
    const blob = createObjectURL.mock.calls[0]![0]
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0, 255, 127, 128, 1])
    expect(blob.type).toBe('image/png')
    expect(downloadedNames).toEqual(['generated.png'])
    expect(window.open).not.toHaveBeenCalled()
  })

  it.each(['s3', 'blob', 'gcs', 'local'])(
    'downloads stored %s files through the logs serve route instead of stale URLs',
    async (provider) => {
      fetchMock.mockResolvedValue(new Response('current stored bytes'))
      const file = {
        ...imageFile,
        base64: undefined,
        key: `execution/workspace/workflow/run/${provider}.png`,
        url: 'https://files.example.com/expired?X-Amz-Expires=300',
      }
      await clickDownload(renderFile(file))
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        `/api/files/serve/${encodeURIComponent(file.key)}?context=execution`,
        { cache: 'no-store' }
      )
      expect(await createObjectURL.mock.calls[0]![0].text()).toBe('current stored bytes')
      expect(downloadedNames).toEqual(['generated.png'])
    }
  )

  it.each(['url/external', 'result-123', ''])(
    'keeps external URL files with key "%s" on their existing URL path',
    async (key) => {
      fetchMock.mockResolvedValue(new Response('external bytes'))
      await clickDownload(renderFile({ ...imageFile, base64: undefined, key }))
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(imageFile.url, { cache: 'no-store' })
    }
  )

  it('preserves delivered signed access for public visitors without a workspace session', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response('publicly delivered bytes'))
    await clickDownload(renderFile({ ...imageFile, base64: undefined }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, imageFile.url, { cache: 'no-store' })
    expect(downloadedNames).toEqual(['generated.png'])
  })

  it.each([false, true])(
    'offers a safe browser download when an external host blocks CORS (stored=%s)',
    async (stored) => {
      if (stored) fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }))
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      const container = renderFile({
        ...imageFile,
        base64: undefined,
        key: stored ? imageFile.key : 'result-123',
      })
      await clickDownload(container)
      const link = container.querySelector('a')!
      expect(link.href).toBe(imageFile.url)
      expect(link.download).toBe(imageFile.name)
      expect(link.rel).toBe('noopener noreferrer')
      expect(link.target).toBe('_blank')
      expect(window.open).not.toHaveBeenCalled()
    }
  )

  it('cancels both discarded authentication and failed download response bodies', async () => {
    const cancelAuthentication = vi.fn()
    const cancelDownload = vi.fn()
    fetchMock.mockResolvedValueOnce(
      new Response(new ReadableStream({ cancel: cancelAuthentication }), { status: 401 })
    )
    fetchMock.mockResolvedValueOnce(
      new Response(new ReadableStream({ cancel: cancelDownload }), { status: 403 })
    )
    const container = renderFile({ ...imageFile, base64: undefined })
    await clickDownload(container)
    expect(cancelAuthentication).toHaveBeenCalledTimes(1)
    expect(cancelDownload).toHaveBeenCalledTimes(1)
    expect(container.querySelector('a')).toBeNull()
  })

  it('shows download errors without opening an expired storage error page', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response('<Error>Request has expired</Error>', { status: 403 }))
    const container = renderFile({ ...imageFile, base64: undefined })
    await clickDownload(container)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unable to download')
    expect(downloadedNames).toEqual([])
    expect(window.open).not.toHaveBeenCalled()
    expect(container.querySelector('button')?.disabled).toBe(false)
  })

  it.each([403, 404])(
    'does not retry denied or deleted stored files through their old URLs (%s)',
    async (status) => {
      fetchMock.mockResolvedValue(new Response(null, { status }))
      const container = renderFile({ ...imageFile, base64: undefined })
      await clickDownload(container)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(downloadedNames).toEqual([])
      expect(container.querySelector('a')).toBeNull()
    }
  )

  it('uses the same inline and storage handling for download all', async () => {
    fetchMock.mockResolvedValue(new Response('stored bytes'))
    const stored = { ...imageFile, id: 'stored', name: 'stored.png', base64: undefined }
    const container = renderFile([imageFile, stored])
    await act(async () => {
      container.querySelector('button')!.click()
      await vi.waitFor(() => expect(downloadedNames).toEqual(['generated.png', 'stored.png']))
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports partial bulk failures, continues the batch, and clears the alert after a successful retry', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }))
    const stored = { ...imageFile, id: 'stored', name: 'stored.png', base64: undefined }
    const container = renderFile([stored, imageFile])
    await clickDownload(container)
    expect(downloadedNames).toEqual(['generated.png'])
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Unable to download 1 file'
    )
    fetchMock.mockResolvedValue(new Response('stored bytes'))
    await act(async () => {
      container.querySelector('button')!.click()
      await vi.waitFor(() =>
        expect(downloadedNames).toEqual(['generated.png', 'stored.png', 'generated.png'])
      )
    })
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('uses the recognized key context when metadata omits it', async () => {
    fetchMock.mockResolvedValue(new Response('workspace bytes'))
    await clickDownload(
      renderFile({ ...imageFile, base64: undefined, key: 'workspace/id/file.png' })
    )
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      '/api/files/serve/workspace%2Fid%2Ffile.png?context=workspace',
      { cache: 'no-store' }
    )
  })
})

it('refuses unsafe external file URLs', async () => {
  const container = renderFile({
    ...imageFile,
    base64: undefined,
    key: 'url/external',
    url: 'javascript:alert(1)',
  })
  await clickDownload(container)
  expect(fetchMock).not.toHaveBeenCalled()
  expect(window.open).not.toHaveBeenCalled()
  expect(downloadedNames).toEqual([])
})
