/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { AttachmentDownloadBudget } from '@/lib/uploads/utils/attachment-download-budget'
import { downloadAttachments, outlookReadTool } from '@/tools/outlook/read'

const fetchMock = vi.fn<typeof fetch>()
const attachment = {
  '@odata.type': '#microsoft.graph.fileAttachment',
  id: 'file/1',
  name: 'report.pdf',
  contentType: 'application/pdf',
  size: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Outlook message attachment downloads', () => {
  it('requests metadata without base64 and reads a 12 MiB file through $value', async () => {
    const bytes = Buffer.alloc(12 * 1024 * 1024, 4)
    fetchMock.mockResolvedValueOnce(
      Response.json({ value: [{ ...attachment, size: bytes.length }] })
    )
    fetchMock.mockResolvedValueOnce(new Response(bytes))
    const files = await downloadAttachments('message/1', 'token')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      'message%2F1/attachments?$select=id,name,contentType,size'
    )
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/file%2F1/$value')
    const data = files[0]!.data
    if (!Buffer.isBuffer(data)) throw new Error('Expected buffered attachment')
    expect(data.equals(bytes)).toBe(true)
    expect(files[0]?.contentType).toBe('application/pdf')
  })

  it('shares the aggregate budget across separate messages', async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).includes('$select')
        ? Response.json({ value: [attachment] })
        : new Response('four')
    )
    const budget = new AttachmentDownloadBudget({ maxBytes: 6 })
    await downloadAttachments('first', 'token', budget)
    await expect(downloadAttachments('second', 'token', budget)).rejects.toBeInstanceOf(
      PayloadSizeLimitError
    )
  })

  it('keeps empty files and skips item attachments', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        value: [attachment, { ...attachment, '@odata.type': '#microsoft.graph.itemAttachment' }],
      })
    )
    fetchMock.mockResolvedValueOnce(new Response(''))
    const files = await downloadAttachments('message', 'token')
    expect(files).toHaveLength(1)
    expect(files[0]?.size).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('preserves per-message aliases by identity for centralized storage replacement', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation(async (url, init) => {
      expect(init?.signal).toBe(controller.signal)
      return String(url).includes('$select')
        ? Response.json({ value: [attachment] })
        : new Response('data')
    })
    const result = await outlookReadTool.transformResponse!(
      Response.json({ value: [{ id: 'message', hasAttachments: true }] }),
      { accessToken: 'token', folder: 'Inbox', maxResults: 1, includeAttachments: true },
      { signal: controller.signal }
    )
    const files = 'attachments' in result.output ? result.output.attachments : undefined
    if (!Array.isArray(files)) throw new Error('Expected attachments')
    expect(result.output.results[0]?.attachments?.[0]).toBe(files[0])
    expect(Buffer.isBuffer(files[0]?.data)).toBe(true)
  })

  it('does not swallow cancellation during attachment reads', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation(async () => {
      controller.abort(new DOMException('cancelled', 'AbortError'))
      return Response.json({ value: [attachment] })
    })
    await expect(
      downloadAttachments(
        'message',
        'token',
        new AttachmentDownloadBudget({ signal: controller.signal })
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
