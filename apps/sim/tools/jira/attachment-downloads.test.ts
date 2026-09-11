/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { AttachmentDownloadBudget } from '@/lib/uploads/utils/attachment-download-budget'

vi.mock('@/lib/knowledge/documents/utils', () => ({
  fetchWithRetry: (url: string, init: RequestInit) => fetch(url, init),
}))

import { jiraGetAttachmentsTool } from '@/tools/jira/get_attachments'
import { jiraRetrieveTool } from '@/tools/jira/retrieve'
import { downloadJiraAttachments } from '@/tools/jira/utils'

const fetchMock = vi.fn<typeof fetch>()
const attachment = {
  id: 'file-1',
  filename: 'report.pdf',
  mimeType: 'application/pdf',
  size: 0,
  content: 'https://example.atlassian.net/content/file-1',
}
const params = {
  accessToken: 'token',
  domain: 'example.atlassian.net',
  issueKey: 'TEST-1',
  cloudId: 'cloud',
  includeAttachments: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Jira attachment downloads', () => {
  it('returns buffered files above 10 MiB', async () => {
    const bytes = Buffer.alloc(12 * 1024 * 1024, 7)
    fetchMock.mockResolvedValue(new Response(bytes))
    const files = await downloadJiraAttachments([{ ...attachment, size: bytes.length }], 'token')
    expect(files[0]?.data.equals(bytes)).toBe(true)
    expect(files[0]?.size).toBe(bytes.length)
  })

  it('retains the existing 50 MiB declared-size skip policy', async () => {
    const files = await downloadJiraAttachments(
      [{ ...attachment, size: 50 * 1024 * 1024 + 1 }],
      'token'
    )
    expect(files).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('enforces the actual 50 MiB file cap as well', async () => {
    fetchMock.mockResolvedValue(
      new Response('tiny', { headers: { 'content-length': String(50 * 1024 * 1024 + 1) } })
    )
    await expect(downloadJiraAttachments([attachment], 'token')).rejects.toBeInstanceOf(
      PayloadSizeLimitError
    )
  })

  it('shares actual downloaded bytes across attachments', async () => {
    fetchMock.mockImplementation(async () => new Response('four'))
    await expect(
      downloadJiraAttachments(
        [attachment, attachment],
        'token',
        new AttachmentDownloadBudget({ maxBytes: 6 })
      )
    ).rejects.toBeInstanceOf(PayloadSizeLimitError)
  })

  it.each([jiraGetAttachmentsTool, jiraRetrieveTool])(
    'forwards cancellation for $id',
    async (tool) => {
      const controller = new AbortController()
      fetchMock.mockImplementation(async (url, init) => {
        expect(init?.signal).toBe(controller.signal)
        if (String(url).includes('/content/')) {
          controller.abort(new DOMException('cancelled', 'AbortError'))
          return new Response('data')
        }
        return Response.json({ comments: [], worklogs: [] })
      })
      await expect(
        tool.transformResponse!(
          Response.json({ id: 'issue', key: 'TEST-1', fields: { attachment: [attachment] } }),
          params,
          { signal: controller.signal }
        )
      ).rejects.toMatchObject({ name: 'AbortError' })
    }
  )
})
