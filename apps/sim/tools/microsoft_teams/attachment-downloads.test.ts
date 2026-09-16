/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { AttachmentDownloadBudget } from '@/lib/uploads/utils/attachment-download-budget'
import { readChannelTool } from '@/tools/microsoft_teams/read_channel'
import { readChatTool } from '@/tools/microsoft_teams/read_chat'
import {
  downloadAllReferenceAttachments,
  fetchHostedContentsForChatMessage,
} from '@/tools/microsoft_teams/utils'

const fetchMock = vi.fn<typeof fetch>()
const params = {
  accessToken: 'token',
  chatId: 'chat/1',
  teamId: 'team/1',
  channelId: 'channel/1',
  messageId: 'message/1',
  includeAttachments: true,
}
const reference = {
  id: 'ref',
  name: 'report.pdf',
  contentType: 'reference',
  contentUrl: 'https://tenant.sharepoint.com/report.pdf',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Teams attachment downloads', () => {
  it('uses raw hosted-content $value when Graph JSON fields are null', async () => {
    const bytes = Buffer.alloc(12 * 1024 * 1024, 2)
    fetchMock.mockResolvedValueOnce(
      Response.json({ value: [{ id: 'hosted/1', contentBytes: null, contentType: null }] })
    )
    fetchMock.mockResolvedValueOnce(
      new Response(bytes, { headers: { 'content-type': 'image/png' } })
    )
    const files = await fetchHostedContentsForChatMessage(params)
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/hostedContents/hosted%2F1/$value')
    const data = files[0]?.data
    if (!Buffer.isBuffer(data)) throw new Error('Expected buffered hosted content')
    expect(data.equals(bytes)).toBe(true)
    expect(files[0]?.mimeType).toBe('image/png')
  })

  it('shares the budget across hosted content and SharePoint reference downloads', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ value: [{ id: 'hosted' }] }))
    fetchMock.mockResolvedValueOnce(new Response('four'))
    fetchMock.mockResolvedValueOnce(
      Response.json({ name: 'report.pdf', size: 4, file: { mimeType: 'application/pdf' } })
    )
    const budget = new AttachmentDownloadBudget({ maxBytes: 6 })
    await fetchHostedContentsForChatMessage({ ...params, budget })
    await expect(
      downloadAllReferenceAttachments({ accessToken: 'token', attachments: [reference], budget })
    ).rejects.toBeInstanceOf(PayloadSizeLimitError)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('bounds actual reference-file bytes despite understated metadata', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ name: 'report.pdf', size: 1 }))
    fetchMock.mockResolvedValueOnce(new Response('four'))
    await expect(
      downloadAllReferenceAttachments({
        accessToken: 'token',
        attachments: [reference],
        budget: new AttachmentDownloadBudget({ maxBytes: 3 }),
      })
    ).rejects.toBeInstanceOf(PayloadSizeLimitError)
  })

  it.each([readChatTool, readChannelTool])(
    'preserves per-message file aliases and cancellation for $id',
    async (tool) => {
      const controller = new AbortController()
      fetchMock.mockImplementation(async (url, init) => {
        expect(init?.signal).toBe(controller.signal)
        return String(url).endsWith('/$value')
          ? new Response('')
          : Response.json({ value: [{ id: 'hosted' }] })
      })
      const result = await tool.transformResponse!(
        Response.json({ value: [{ id: 'message', body: { content: 'hello' }, attachments: [] }] }),
        params,
        { signal: controller.signal }
      )
      expect(result.output.attachments).toHaveLength(1)
      expect(result.output.metadata.messages?.[0]?.uploadedFiles?.[0]).toBe(
        result.output.attachments?.[0]
      )
      const file = result.output.attachments?.[0]
      expect(file && 'data' in file && Buffer.isBuffer(file.data)).toBe(true)
    }
  )

  it('propagates cancellation rather than returning missing attachments', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation(async () => {
      controller.abort(new DOMException('cancelled', 'AbortError'))
      return Response.json({ value: [{ id: 'hosted' }] })
    })
    await expect(
      readChatTool.transformResponse!(
        Response.json({ value: [{ id: 'message', attachments: [] }] }),
        params,
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
