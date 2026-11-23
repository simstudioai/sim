import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getContentTool } from '@/tools/google_drive/get_content'
import { MAX_EXPORT_BYTES } from '@/tools/google_drive/utils'

const transform = getContentTool.transformResponse as NonNullable<
  typeof getContentTool.transformResponse
>

function streamOf(totalBytes: number, chunkBytes = 1024 * 1024): ReadableStream<Uint8Array> {
  let sent = 0
  return new ReadableStream({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close()
        return
      }
      const size = Math.min(chunkBytes, totalBytes - sent)
      sent += size
      controller.enqueue(new Uint8Array(size).fill(97))
    },
  })
}

describe('google_drive_get_content byte limits', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('refuses a binary file whose declared size exceeds the download cap before fetching it', async () => {
    await expect(
      transform(
        jsonResponse({
          id: 'file-1',
          name: 'huge.bin',
          mimeType: 'application/octet-stream',
          size: String(200 * 1024 * 1024),
        }),
        { accessToken: 'token', fileId: 'file-1', includeRevisions: false }
      )
    ).rejects.toThrow(/exceeds maximum size/)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stops reading a Workspace export that streams past the export cap', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(streamOf(MAX_EXPORT_BYTES + 1024 * 1024), { status: 200 })
    )

    await expect(
      transform(
        jsonResponse({
          id: 'doc-1',
          name: 'Doc',
          mimeType: 'application/vnd.google-apps.document',
        }),
        { accessToken: 'token', fileId: 'doc-1', includeRevisions: false }
      )
    ).rejects.toThrow(/exceeds maximum size/)
  })
})
