import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  downloadServableFilesWithinBudget: vi.fn(),
  empty: vi.fn(),
  buffer: vi.fn(),
  json: vi.fn(),
  processFilesToUserFiles: vi.fn(),
}))

vi.mock('@/lib/internal/outlook/client', () => ({
  OutlookClient: class {
    json(...args: unknown[]) {
      return mocks.json(...args)
    }

    buffer(...args: unknown[]) {
      return mocks.buffer(...args)
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

import { OutlookOperationError } from '@/lib/internal/outlook/errors'
import { executeOutlookGetAttachment, executeOutlookSend } from '@/lib/internal/outlook/operations'
import {
  isInternalToolFileResult,
  type StoredToolFile,
} from '@/lib/internal/tool-operations/file-result'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

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
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.downloadServableFilesWithinBudget.mockResolvedValue([
      { buffer: Buffer.from('report'), contentType: 'application/pdf' },
    ])
    mocks.empty.mockResolvedValue(undefined)
    mocks.buffer.mockResolvedValue({ buffer: Buffer.alloc(0), contentType: null })
    mocks.json.mockResolvedValue({})
    mocks.processFilesToUserFiles.mockReturnValue([])
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

  it('fails closed when file access is denied', async () => {
    mocks.processFilesToUserFiles.mockReturnValue([USER_FILE])
    mocks.assertToolFileAccess.mockResolvedValue(new Response(null, { status: 404 }))

    await expect(
      executeOutlookSend({ ...MAIL_INPUT, attachments: [RAW_ATTACHMENT] }, MAIL_CONTEXT)
    ).rejects.toEqual(new OutlookOperationError('File not found', 404))
    expect(mocks.downloadServableFilesWithinBudget).not.toHaveBeenCalled()
  })
})

const ATTACHMENT_INPUT = {
  accessToken: 'access-token',
  messageId: ' message/1 ',
  attachmentId: ' attachment/1 ',
}

const ATTACHMENT_METADATA = {
  '@odata.type': '#microsoft.graph.fileAttachment',
  id: 'attachment/1',
  name: 'report.xlsx',
  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  size: 12 * 1024 * 1024,
  isInline: false,
  lastModifiedDateTime: '2026-09-11T10:00:00Z',
}

describe('Outlook attachment downloads', () => {
  beforeEach(() => {
    mocks.json.mockResolvedValue(ATTACHMENT_METADATA)
    mocks.buffer.mockResolvedValue({ buffer: Buffer.alloc(0), contentType: null })
  })

  it('fetches metadata separately and presents a large file as a stored reference', async () => {
    const buffer = Buffer.alloc(12 * 1024 * 1024, 1)
    const controller = new AbortController()
    mocks.buffer.mockResolvedValue({ buffer, contentType: 'application/octet-stream' })

    const result = await executeOutlookGetAttachment(ATTACHMENT_INPUT, controller.signal)

    expect(mocks.json).toHaveBeenCalledWith(
      '/me/messages/message%2F1/attachments/attachment%2F1?$select=id,name,contentType,size,isInline,lastModifiedDateTime',
      { method: 'GET' },
      'Failed to retrieve attachment',
      controller.signal
    )
    expect(mocks.buffer).toHaveBeenCalledWith(
      '/me/messages/message%2F1/attachments/attachment%2F1/$value',
      MAX_BUFFERED_TRANSFER_BYTES,
      'Failed to download attachment',
      controller.signal
    )
    if (!isInternalToolFileResult(result)) throw new Error('Expected a file result')
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.buffer).toBe(buffer)
    expect(result.files[0]?.name).toBe(ATTACHMENT_METADATA.name)
    expect(result.files[0]?.mimeType).toBe(ATTACHMENT_METADATA.contentType)
    const stored: StoredToolFile = {
      id: 'stored-1',
      key: 'execution/stored-1',
      name: ATTACHMENT_METADATA.name,
      size: buffer.byteLength,
      type: ATTACHMENT_METADATA.contentType,
      mimeType: ATTACHMENT_METADATA.contentType,
      url: '/api/files/serve/stored-1',
    }
    const body = result.present([stored])
    expect(body).toEqual({
      success: true,
      output: {
        message: 'Successfully retrieved attachment "report.xlsx".',
        results: {
          id: 'attachment/1',
          name: ATTACHMENT_METADATA.name,
          contentType: ATTACHMENT_METADATA.contentType,
          size: buffer.byteLength,
          isInline: false,
          attachmentType: '#microsoft.graph.fileAttachment',
          lastModifiedDateTime: ATTACHMENT_METADATA.lastModifiedDateTime,
        },
        attachments: [stored],
      },
    })
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(2000)
    expect(JSON.stringify(body)).not.toContain('contentBytes')
  })

  it('rejects metadata above 100 MiB before fetching file bytes', async () => {
    mocks.json.mockResolvedValue({
      ...ATTACHMENT_METADATA,
      size: MAX_BUFFERED_TRANSFER_BYTES + 1,
    })

    await expect(executeOutlookGetAttachment(ATTACHMENT_INPUT)).rejects.toMatchObject({
      status: 413,
    })
    expect(mocks.buffer).not.toHaveBeenCalled()
  })
})
