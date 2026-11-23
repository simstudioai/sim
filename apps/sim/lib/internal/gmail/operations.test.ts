import { fileUtilsMock, fileUtilsMockFns } from '@sim/testing/mocks/file-utils.mock'
import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)

vi.mock('@/lib/uploads/utils/file', () => fileUtilsMock)

vi.mock('@/lib/uploads/utils/file.server', () => fileUtilsServerMock)

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockProcessFilesToUserFiles } = fileUtilsMockFns
const { mockDownloadServableFilesWithinBudget } = fileUtilsServerMockFns

import { GmailOperationError } from '@/lib/internal/gmail/errors'
import { executeGmailTool } from '@/lib/internal/gmail/execute-tool'
import { executeGmailSend } from '@/lib/internal/gmail/mail'

const MAIL = {
  accessToken: 'access-token',
  to: 'recipient@example.com',
  body: 'Hello',
}
const STORED_FILE = {
  id: 'file-1',
  key: 'workspace/file.txt',
  name: 'file.txt',
  size: 4,
  type: 'text/plain',
}

describe('Gmail operations', () => {
  beforeEach(() => {
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockProcessFilesToUserFiles.mockReturnValue([STORED_FILE])
    mockDownloadServableFilesWithinBudget.mockResolvedValue([
      { buffer: Buffer.from('test'), contentType: 'text/plain' },
    ])
  })

  it('fails closed before file download and provider work when access is denied', async () => {
    mockAssertToolFileAccess.mockResolvedValue(
      Response.json({ success: false, error: 'File not found' }, { status: 404 })
    )
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      executeGmailSend(
        { ...MAIL, attachments: [STORED_FILE] },
        { requestId: 'request-1', userId: 'user-1' }
      )
    ).rejects.toEqual(
      new GmailOperationError('File not found', 404, {
        success: false,
        error: 'File not found',
      })
    )
    expect(mockDownloadServableFilesWithinBudget).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  describe('Reply-To header', () => {
    const cases = [
      { toolId: 'gmail_send_v2', input: {} },
      { toolId: 'gmail_draft_v2', input: {} },
      { toolId: 'gmail_edit_draft_v2', input: { draftId: 'draft-1' } },
    ]

    async function rawHeaderLines(toolId: string, input: Record<string, unknown>) {
      const fetchMock = vi.fn(async () => Response.json({ id: 'x', message: { id: 'm' } }))
      vi.stubGlobal('fetch', fetchMock)
      const response = await executeGmailTool({
        toolId,
        input: { ...MAIL, ...input },
        headers: new Headers(),
        context: { workflowId: 'wf', userId: 'user-1' },
        requestId: 'request-1',
      })
      expect(response.status).toBe(200)
      const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      const body = JSON.parse(String(call[1].body)) as { raw?: string; message?: { raw: string } }
      const raw = body.raw ?? body.message?.raw ?? ''
      const mime = Buffer.from(raw, 'base64url').toString('utf-8')
      return mime.slice(0, mime.indexOf('\n\n')).split('\n')
    }

    it.each(cases)('emits a sanitized Reply-To through $toolId', async ({ toolId, input }) => {
      const lines = await rawHeaderLines(toolId, {
        ...input,
        replyTo: 'support@example.com\r\nBcc: evil@example.com',
      })
      expect(lines).toContain('Reply-To: support@example.com Bcc: evil@example.com')
      expect(lines.some((line) => line.startsWith('Bcc:'))).toBe(false)
    })

    it.each(cases)('omits Reply-To when unset in $toolId', async ({ toolId, input }) => {
      const lines = await rawHeaderLines(toolId, input)
      expect(lines.some((line) => line.startsWith('Reply-To:'))).toBe(false)
    })
  })
})
