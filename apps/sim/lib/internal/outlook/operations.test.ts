/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  downloadServableFilesWithinBudget: vi.fn(),
  empty: vi.fn(),
  json: vi.fn(),
  processFilesToUserFiles: vi.fn(),
}))

vi.mock('@/lib/internal/outlook/client', () => ({
  OutlookClient: class {
    json(...args: unknown[]) {
      return mocks.json(...args)
    }

    empty(...args: unknown[]) {
      return mocks.empty(...args)
    }
  },
}))
vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processFilesToUserFiles: mocks.processFilesToUserFiles,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFilesWithinBudget: mocks.downloadServableFilesWithinBudget,
}))

import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { OutlookOperationError } from '@/lib/internal/outlook/errors'
import {
  executeOutlookCopy,
  executeOutlookDelete,
  executeOutlookDraft,
  executeOutlookMarkRead,
  executeOutlookMarkUnread,
  executeOutlookMove,
  executeOutlookSend,
} from '@/lib/internal/outlook/operations'

const MAIL_INPUT = {
  accessToken: 'access-token',
  to: 'first@example.com, second@example.com',
  subject: 'Hello',
  body: 'Message body',
  contentType: 'html' as const,
  cc: 'cc@example.com',
  bcc: 'bcc@example.com',
}

const MAIL_CONTEXT = {
  requestId: 'request-1',
  userId: 'user-1',
}

const RAW_ATTACHMENT = {
  id: 'file-1',
  key: 'workspace/file-1',
  name: 'report.pdf',
  size: 6,
  type: 'application/pdf',
}

const USER_FILE = {
  ...RAW_ATTACHMENT,
  url: '/api/files/serve?key=workspace/file-1',
  context: 'workspace',
}

describe('Outlook operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.downloadServableFilesWithinBudget.mockResolvedValue([
      { buffer: Buffer.from('report'), contentType: 'application/pdf' },
    ])
    mocks.empty.mockResolvedValue(undefined)
    mocks.json.mockResolvedValue({})
    mocks.processFilesToUserFiles.mockReturnValue([])
  })

  it('copies messages using encoded Graph paths and preserves outputs', async () => {
    const controller = new AbortController()
    mocks.json.mockResolvedValue({ id: 'copied-1', parentFolderId: 'folder-1' })

    const result = await executeOutlookCopy(
      {
        accessToken: 'access-token',
        messageId: 'message/1',
        destinationId: 'folder-1',
      },
      controller.signal
    )

    expect(mocks.json).toHaveBeenCalledWith(
      '/me/messages/message%2F1/copy',
      { method: 'POST', body: JSON.stringify({ destinationId: 'folder-1' }) },
      'Failed to copy email',
      controller.signal
    )
    expect(result).toEqual({
      success: true,
      output: {
        message: 'Email copied successfully',
        originalMessageId: 'message/1',
        copiedMessageId: 'copied-1',
        destinationFolderId: 'folder-1',
      },
    })
  })

  it('deletes messages and preserves the route output contract', async () => {
    const result = await executeOutlookDelete({
      accessToken: 'access-token',
      messageId: 'message-1',
    })

    expect(mocks.empty).toHaveBeenCalledWith(
      '/me/messages/message-1',
      { method: 'DELETE' },
      'Failed to delete email',
      undefined
    )
    expect(result.output).toEqual({
      message: 'Email moved to Deleted Items successfully',
      messageId: 'message-1',
      status: 'deleted',
    })
  })

  it.each([
    [executeOutlookMarkRead, true, 'read'],
    [executeOutlookMarkUnread, false, 'unread'],
  ] as const)('updates message read state', async (execute, isRead, label) => {
    mocks.json.mockResolvedValue({ id: 'message-1', isRead })

    const result = await execute({ accessToken: 'access-token', messageId: 'message-1' })

    expect(mocks.json).toHaveBeenCalledWith(
      '/me/messages/message-1',
      { method: 'PATCH', body: JSON.stringify({ isRead }) },
      `Failed to mark email as ${label}`,
      undefined
    )
    expect(result.output).toMatchObject({ messageId: 'message-1', isRead })
  })

  it('moves messages and returns the new canonical IDs', async () => {
    mocks.json.mockResolvedValue({ id: 'moved-1', parentFolderId: 'folder-2' })

    const result = await executeOutlookMove({
      accessToken: 'access-token',
      messageId: 'message-1',
      destinationId: 'folder-2',
    })

    expect(mocks.json).toHaveBeenCalledWith(
      '/me/messages/message-1/move',
      { method: 'POST', body: JSON.stringify({ destinationId: 'folder-2' }) },
      'Failed to move email',
      undefined
    )
    expect(result.output).toMatchObject({ messageId: 'moved-1', newFolderId: 'folder-2' })
  })

  it('creates drafts with recipients and exact output fields', async () => {
    mocks.json.mockResolvedValue({ id: 'draft-1', subject: 'Hello' })

    const result = await executeOutlookDraft(MAIL_INPUT, MAIL_CONTEXT)

    expect(mocks.json).toHaveBeenCalledWith(
      '/me/messages',
      {
        method: 'POST',
        body: JSON.stringify({
          subject: 'Hello',
          body: { contentType: 'html', content: 'Message body' },
          toRecipients: [
            { emailAddress: { address: 'first@example.com' } },
            { emailAddress: { address: 'second@example.com' } },
          ],
          ccRecipients: [{ emailAddress: { address: 'cc@example.com' } }],
          bccRecipients: [{ emailAddress: { address: 'bcc@example.com' } }],
        }),
      },
      'Failed to create draft',
      undefined
    )
    expect(result.output).toEqual({
      message: 'Draft created successfully',
      messageId: 'draft-1',
      subject: 'Hello',
      attachmentCount: 0,
    })
  })

  it('sends new messages with the Graph sendMail envelope', async () => {
    const result = await executeOutlookSend(MAIL_INPUT, MAIL_CONTEXT)

    const [path, init, fallback] = mocks.empty.mock.calls[0]
    expect(path).toBe('/me/sendMail')
    expect(fallback).toBe('Failed to send email')
    expect(JSON.parse(init.body)).toMatchObject({
      saveToSentItems: true,
      message: {
        subject: 'Hello',
        body: { contentType: 'html', content: 'Message body' },
      },
    })
    expect(result.output).toMatchObject({
      message: 'Email sent successfully',
      status: 'sent',
      attachmentCount: 0,
      timestamp: expect.any(String),
    })
  })

  it('preserves reply envelopes and encodes reply message IDs', async () => {
    await executeOutlookSend({ ...MAIL_INPUT, replyToMessageId: 'message/1' }, MAIL_CONTEXT)

    const [path, init] = mocks.empty.mock.calls[0]
    expect(path).toBe('/me/messages/message%2F1/reply')
    expect(JSON.parse(init.body)).toMatchObject({
      comment: 'Message body',
      message: { subject: 'Hello' },
    })
  })

  it.each([
    [executeOutlookSend, 3 * 1024 * 1024, '3MB', 'Microsoft Graph API limit'],
    [executeOutlookDraft, 4 * 1024 * 1024, '4MB', "Outlook's limit"],
  ] as const)(
    'enforces the operation attachment cap before file access',
    async (execute, maxBytes, limitLabel, providerLabel) => {
      mocks.processFilesToUserFiles.mockReturnValue([{ ...USER_FILE, size: maxBytes + 1 }])

      await expect(
        execute({ ...MAIL_INPUT, attachments: [RAW_ATTACHMENT] }, MAIL_CONTEXT)
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining(`${providerLabel} of ${limitLabel} per request`),
      })
      expect(mocks.assertToolFileAccess).not.toHaveBeenCalled()
    }
  )

  it('authorizes, bounds, and attaches resolved servable bytes', async () => {
    const controller = new AbortController()
    mocks.processFilesToUserFiles.mockReturnValue([USER_FILE])

    const result = await executeOutlookDraft(
      { ...MAIL_INPUT, attachments: [RAW_ATTACHMENT] },
      { ...MAIL_CONTEXT, signal: controller.signal }
    )

    expect(mocks.assertToolFileAccess).toHaveBeenCalledWith(
      'workspace/file-1',
      'user-1',
      'request-1',
      expect.any(Object)
    )
    expect(mocks.downloadServableFilesWithinBudget).toHaveBeenCalledWith(
      [USER_FILE],
      'request-1',
      expect.any(Object),
      {
        totalMaxBytes: 4 * 1024 * 1024,
        label: 'Total attachment size',
        signal: controller.signal,
      }
    )
    const message = JSON.parse(mocks.json.mock.calls[0][1].body)
    expect(message.attachments).toEqual([
      {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: 'report.pdf',
        contentType: 'application/pdf',
        contentBytes: Buffer.from('report').toString('base64'),
      },
    ])
    expect(result.output.attachmentCount).toBe(1)
  })

  it('fails closed when file access is denied', async () => {
    mocks.processFilesToUserFiles.mockReturnValue([USER_FILE])
    mocks.assertToolFileAccess.mockResolvedValue(new Response(null, { status: 404 }))

    await expect(
      executeOutlookSend({ ...MAIL_INPUT, attachments: [RAW_ATTACHMENT] }, MAIL_CONTEXT)
    ).rejects.toEqual(new OutlookOperationError('File not found', 404))
    expect(mocks.downloadServableFilesWithinBudget).not.toHaveBeenCalled()
  })

  it('maps delivered-byte overruns to the exact Outlook size envelope', async () => {
    mocks.processFilesToUserFiles.mockReturnValue([USER_FILE])
    mocks.downloadServableFilesWithinBudget.mockRejectedValue(
      new PayloadSizeLimitError({
        label: 'Total attachment size',
        maxBytes: 4 * 1024 * 1024,
        observedBytes: 5 * 1024 * 1024,
      })
    )

    await expect(
      executeOutlookDraft({ ...MAIL_INPUT, attachments: [RAW_ATTACHMENT] }, MAIL_CONTEXT)
    ).rejects.toMatchObject({
      status: 400,
      message: "Total attachment size (5.00MB) exceeds Outlook's limit of 4MB per request",
    })
  })

  it('requires an authenticated user for send and draft operations', async () => {
    await expect(executeOutlookSend(MAIL_INPUT, { requestId: 'request-1' })).rejects.toEqual(
      new OutlookOperationError('Authentication required', 401)
    )
    expect(mocks.empty).not.toHaveBeenCalled()
  })

  it('propagates cancellation before file or provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeOutlookDraft(MAIL_INPUT, { ...MAIL_CONTEXT, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.json).not.toHaveBeenCalled()
    expect(mocks.assertToolFileAccess).not.toHaveBeenCalled()
  })
})
