import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { AttachmentDownloadBudget } from '@/lib/uploads/utils/attachment-download-budget'
import { gmailReadTool, gmailReadV2Tool } from '@/tools/gmail/read'
import { downloadAttachments } from '@/tools/gmail/utils'

const fetchMock = vi.fn<typeof fetch>()
const attachment = {
  attachmentId: 'file/1',
  filename: 'report.pdf',
  mimeType: 'application/pdf',
  size: 0,
}
const params = { accessToken: 'token', messageId: 'message/1', includeAttachments: true }
const message = {
  id: 'message/1',
  threadId: 'thread-1',
  labelIds: [],
  snippet: '',
  payload: {
    headers: [],
    body: {},
    parts: [
      {
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        body: { attachmentId: 'file/1', size: 0 },
      },
    ],
  },
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

describe('Gmail attachment downloads', () => {
  it('decodes a 12 MiB provider response directly to a Buffer', async () => {
    const bytes = Buffer.alloc(12 * 1024 * 1024, 9)
    fetchMock.mockResolvedValue(
      Response.json({ data: bytes.toString('base64url'), size: bytes.length })
    )
    const files = await downloadAttachments(
      'message/1',
      [{ ...attachment, size: bytes.length }],
      'token'
    )
    expect(files).toHaveLength(1)
    const data = files[0]!.data
    expect(Buffer.isBuffer(data)).toBe(true)
    if (!Buffer.isBuffer(data)) throw new Error('Expected buffered attachment')
    expect(data.equals(bytes)).toBe(true)
    expect(fetchMock.mock.calls[0]?.[0]).toContain('message%2F1/attachments/file%2F1')
  })

  it('checks decoded aggregate bytes even when metadata understates size', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ data: Buffer.from('abcd').toString('base64url') })
    )
    const budget = new AttachmentDownloadBudget({ maxBytes: 6 })
    await expect(
      downloadAttachments('message', [attachment, attachment], 'token', budget)
    ).rejects.toBeInstanceOf(PayloadSizeLimitError)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects an oversized JSON envelope before parsing it', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { headers: { 'content-length': '1000000' } }))
    await expect(
      downloadAttachments(
        'message',
        [attachment],
        'token',
        new AttachmentDownloadBudget({ maxBytes: 3 })
      )
    ).rejects.toBeInstanceOf(PayloadSizeLimitError)
  })

  it('preserves empty attachment data', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: '', size: 0 }))
    const files = await downloadAttachments('message', [attachment], 'token')
    expect(files[0]?.size).toBe(0)
    expect(Buffer.isBuffer(files[0]?.data)).toBe(true)
  })

  it.each([gmailReadTool, gmailReadV2Tool])('forwards cancellation through $id', async (tool) => {
    const controller = new AbortController()
    fetchMock.mockImplementation(async (_url, init) => {
      expect(init?.signal).toBe(controller.signal)
      controller.abort(new DOMException('cancelled', 'AbortError'))
      return Response.json({ data: 'YQ' })
    })
    await expect(
      tool.transformResponse!(Response.json(message), params, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('skips provider failures without discarding successful attachments', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
    fetchMock.mockResolvedValueOnce(Response.json({ data: 'YQ' }))
    const files = await downloadAttachments('message', [attachment, attachment], 'token')
    expect(files).toHaveLength(1)
    expect(files[0]?.size).toBe(1)
  })
})

describe('Gmail recipient headers', () => {
  const readTransform = gmailReadTool.transformResponse as NonNullable<
    typeof gmailReadTool.transformResponse
  >
  const readV2Transform = gmailReadV2Tool.transformResponse as NonNullable<
    typeof gmailReadV2Tool.transformResponse
  >
  const headers = [
    { name: 'From', value: 'Ana <ana@example.com>' },
    { name: 'To', value: 'bo@example.com' },
    { name: 'CC', value: 'Dana <dana@example.com>, cy@example.com' },
    { name: 'Reply-To', value: 'support@example.com' },
    { name: 'Message-ID', value: '<abc@mail.example.com>' },
    { name: 'Subject', value: 'Plan' },
  ]
  const ccMessage = {
    id: 'm1',
    threadId: 't1',
    labelIds: ['INBOX'],
    snippet: 'Hi team',
    internalDate: '1700000000000',
    payload: { headers, body: { data: Buffer.from('hello').toString('base64') } },
  }

  it('returns Cc on a single read and keeps absent headers null', async () => {
    const legacy = await readTransform(Response.json(ccMessage), {
      accessToken: 'token',
      messageId: 'm1',
      folder: '',
    })
    expect(legacy.output.metadata).toMatchObject({
      cc: 'Dana <dana@example.com>, cy@example.com',
      bcc: null,
      replyTo: 'support@example.com',
      rfcMessageId: '<abc@mail.example.com>',
      inReplyTo: null,
      to: 'bo@example.com',
      date: '',
    })

    const v2 = await readV2Transform(Response.json(ccMessage), {
      accessToken: 'token',
      messageId: 'm1',
      folder: '',
    })
    expect(v2.output.cc).toBe('Dana <dana@example.com>, cy@example.com')
  })

  it('returns Cc for every message in a multi-message read summary', async () => {
    fetchMock.mockImplementation(async () => Response.json(ccMessage))
    const result = await readTransform(
      Response.json({
        messages: [
          { id: 'm1', threadId: 't1' },
          { id: 'm1', threadId: 't1' },
        ],
      }),
      { accessToken: 'token', messageId: '', folder: 'INBOX', maxResults: 2 }
    )
    const results = (result.output.metadata as { results: Array<{ cc?: string | null }> }).results
    expect(results.map((r) => r.cc)).toEqual([
      'Dana <dana@example.com>, cy@example.com',
      'Dana <dana@example.com>, cy@example.com',
    ])
    expect(result.output.content).toContain('Cc: Dana <dana@example.com>, cy@example.com')
  })
})
