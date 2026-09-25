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
  it('uses the canonical serve route for unsafe file URLs', () => {
    const container = renderFile({ ...imageFile, base64: undefined, url: 'javascript:alert(1)' })
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/api/files/serve/execution%2Fgenerated.png?context=execution'
    )
  })
})

async function clickDownload(container: HTMLDivElement): Promise<void> {
  await act(async () => container.querySelector('button')!.click())
}

describe('chat file downloads', () => {
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

  it.each(['', ' \t\n'].flatMap((url) => [false, true].map((stored) => ({ url, stored }))))(
    'never downloads the chat page for a blank URL (%j)',
    async ({ url, stored }) => {
      if (stored) fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }))
      fetchMock.mockResolvedValue(new Response('<html>Chat page</html>'))
      const container = renderFile({
        ...imageFile,
        base64: undefined,
        key: stored ? imageFile.key : 'url/external',
        url,
      })
      await clickDownload(container)
      expect(fetchMock).toHaveBeenCalledTimes(stored ? 1 : 0)
      expect(createObjectURL).not.toHaveBeenCalled()
      expect(downloadedNames).toEqual([])
      expect(container.querySelector('a')).toBeNull()
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unable to download')
    }
  )

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
