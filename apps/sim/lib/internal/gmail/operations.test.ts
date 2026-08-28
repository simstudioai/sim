/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fileMocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  downloadServableFilesWithinBudget: vi.fn(),
  processFilesToUserFiles: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: fileMocks.assertToolFileAccess,
}))

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processFilesToUserFiles: fileMocks.processFilesToUserFiles,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFilesWithinBudget: fileMocks.downloadServableFilesWithinBudget,
}))

import { GmailClient } from '@/lib/internal/gmail/client'
import { GmailOperationError } from '@/lib/internal/gmail/errors'
import { executeGmailSend } from '@/lib/internal/gmail/mail'
import { executeGmailAddLabel, executeGmailMove } from '@/lib/internal/gmail/messages'

const MESSAGE = { accessToken: 'access-token', messageId: 'message-1' }
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
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    fileMocks.assertToolFileAccess.mockResolvedValue(null)
    fileMocks.processFilesToUserFiles.mockReturnValue([STORED_FILE])
    fileMocks.downloadServableFilesWithinBudget.mockResolvedValue([
      { buffer: Buffer.from('test'), contentType: 'text/plain' },
    ])
  })

  it('forwards OAuth credentials and cancellation through message operations', async () => {
    const response = Response.json({ id: 'message-1', threadId: 'thread-1', labelIds: ['INBOX'] })
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await expect(
      executeGmailAddLabel({ ...MESSAGE, labelIds: 'INBOX, STARRED' }, controller.signal)
    ).resolves.toEqual({
      success: true,
      output: {
        content: 'Successfully added 2 label(s) to email',
        metadata: { id: 'message-1', threadId: 'thread-1', labelIds: ['INBOX'] },
      },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/message-1/modify',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
        body: JSON.stringify({ addLabelIds: ['INBOX', 'STARRED'] }),
        signal: controller.signal,
      })
    )
    expect(response.bodyUsed).toBe(true)
  })

  it('rejects an empty parsed label list before provider work', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(() => executeGmailAddLabel({ ...MESSAGE, labelIds: ' , ' })).toThrow(
      'At least one label ID is required'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves move label parsing and omits empty removals', async () => {
    const response = Response.json({ id: 'message-1' })
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)

    await executeGmailMove({ ...MESSAGE, addLabelIds: 'IMPORTANT', removeLabelIds: ' , ' })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/messages/message-1/modify'),
      expect.objectContaining({ body: JSON.stringify({ addLabelIds: ['IMPORTANT'] }) })
    )
  })

  it('rejects empty and invalid move labels before provider work', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(() => executeGmailMove({ ...MESSAGE, addLabelIds: ' , ' })).toThrow(
      'At least one label ID is required'
    )
    expect(() => executeGmailMove({ ...MESSAGE, addLabelIds: 'INVALID/LABEL' })).toThrow(
      'labelId cannot contain directory separators'
    )
    expect(() =>
      executeGmailMove({
        ...MESSAGE,
        addLabelIds: 'IMPORTANT',
        removeLabelIds: 'INVALID/LABEL',
      })
    ).toThrow('labelId cannot contain directory separators')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves provider status and cancels unread error bodies', async () => {
    const response = new Response('provider details', {
      status: 429,
      statusText: 'Too Many Requests',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    await expect(executeGmailMove({ ...MESSAGE, addLabelIds: 'IMPORTANT' })).rejects.toEqual(
      new GmailOperationError('Gmail API error: Too Many Requests', 429, {
        success: false,
        error: 'Gmail API error: Too Many Requests',
      })
    )
    expect(response.bodyUsed).toBe(true)
  })

  it('authorizes and bounds stored attachments before sending', async () => {
    const response = Response.json({ id: 'message-1', threadId: 'thread-1', labelIds: ['SENT'] })
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await executeGmailSend(
      { ...MAIL, attachments: [STORED_FILE] },
      {
        requestId: 'request-1',
        signal: controller.signal,
        userId: 'user-1',
      }
    )

    expect(fileMocks.assertToolFileAccess).toHaveBeenCalledWith(
      'workspace/file.txt',
      'user-1',
      'request-1',
      expect.anything()
    )
    expect(fileMocks.downloadServableFilesWithinBudget).toHaveBeenCalledWith(
      [STORED_FILE],
      'request-1',
      expect.anything(),
      {
        totalMaxBytes: 25 * 1024 * 1024,
        label: 'Total attachment size',
        signal: controller.signal,
      }
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      expect.objectContaining({ signal: controller.signal })
    )
  })

  it('fails closed before file download and provider work when access is denied', async () => {
    fileMocks.assertToolFileAccess.mockResolvedValue(
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
    expect(fileMocks.downloadServableFilesWithinBudget).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires an acting user before constructing mail', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(executeGmailSend(MAIL, { requestId: 'request-1' })).rejects.toEqual(
      new GmailOperationError('Authentication required', 401, {
        success: false,
        error: 'Authentication required',
      })
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses best-effort threading metadata while preserving cancellation', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBe(controller.signal)
      controller.abort(new DOMException('cancelled', 'AbortError'))
      throw controller.signal.reason
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      new GmailClient('access-token').threadingHeaders('message-1', controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
