/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => ({
  executeGmailAddLabel: vi.fn(),
  executeGmailArchive: vi.fn(),
  executeGmailDelete: vi.fn(),
  executeGmailDraft: vi.fn(),
  executeGmailEditDraft: vi.fn(),
  executeGmailMarkRead: vi.fn(),
  executeGmailMarkUnread: vi.fn(),
  executeGmailMove: vi.fn(),
  executeGmailRemoveLabel: vi.fn(),
  executeGmailSend: vi.fn(),
  executeGmailUnarchive: vi.fn(),
}))

vi.mock('@/lib/internal/gmail/mail', () => ({
  executeGmailDraft: operationMocks.executeGmailDraft,
  executeGmailEditDraft: operationMocks.executeGmailEditDraft,
  executeGmailSend: operationMocks.executeGmailSend,
}))

vi.mock('@/lib/internal/gmail/messages', () => ({
  executeGmailAddLabel: operationMocks.executeGmailAddLabel,
  executeGmailArchive: operationMocks.executeGmailArchive,
  executeGmailDelete: operationMocks.executeGmailDelete,
  executeGmailMarkRead: operationMocks.executeGmailMarkRead,
  executeGmailMarkUnread: operationMocks.executeGmailMarkUnread,
  executeGmailMove: operationMocks.executeGmailMove,
  executeGmailRemoveLabel: operationMocks.executeGmailRemoveLabel,
  executeGmailUnarchive: operationMocks.executeGmailUnarchive,
}))

import { GmailOperationError } from '@/lib/internal/gmail/errors'
import { executeGmailTool } from '@/lib/internal/gmail/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const MESSAGE_BODY = { accessToken: 'access-token', messageId: 'message-1' }
const LABEL_BODY = { ...MESSAGE_BODY, labelIds: 'INBOX,STARRED' }
const MOVE_BODY = { ...MESSAGE_BODY, addLabelIds: 'IMPORTANT', removeLabelIds: 'INBOX' }
const MAIL_BODY = {
  accessToken: 'access-token',
  to: 'recipient@example.com',
  body: 'Hello',
}
const EDIT_DRAFT_BODY = { ...MAIL_BODY, draftId: 'draft-1' }

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'gmail_archive',
    input: MESSAGE_BODY,
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      workspaceId: 'workspace-1',
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

const TOOL_CASES = [
  ['gmail_add_label', LABEL_BODY, operationMocks.executeGmailAddLabel, 'message'],
  ['gmail_add_label_v2', LABEL_BODY, operationMocks.executeGmailAddLabel, 'message'],
  ['gmail_archive', MESSAGE_BODY, operationMocks.executeGmailArchive, 'message'],
  ['gmail_archive_v2', MESSAGE_BODY, operationMocks.executeGmailArchive, 'message'],
  ['gmail_delete', MESSAGE_BODY, operationMocks.executeGmailDelete, 'message'],
  ['gmail_delete_v2', MESSAGE_BODY, operationMocks.executeGmailDelete, 'message'],
  ['gmail_draft', MAIL_BODY, operationMocks.executeGmailDraft, 'mail'],
  ['gmail_draft_v2', MAIL_BODY, operationMocks.executeGmailDraft, 'mail'],
  ['gmail_edit_draft_v2', EDIT_DRAFT_BODY, operationMocks.executeGmailEditDraft, 'mail'],
  ['gmail_mark_read', MESSAGE_BODY, operationMocks.executeGmailMarkRead, 'message'],
  ['gmail_mark_read_v2', MESSAGE_BODY, operationMocks.executeGmailMarkRead, 'message'],
  ['gmail_mark_unread', MESSAGE_BODY, operationMocks.executeGmailMarkUnread, 'message'],
  ['gmail_mark_unread_v2', MESSAGE_BODY, operationMocks.executeGmailMarkUnread, 'message'],
  ['gmail_move', MOVE_BODY, operationMocks.executeGmailMove, 'message'],
  ['gmail_move_v2', MOVE_BODY, operationMocks.executeGmailMove, 'message'],
  ['gmail_remove_label', LABEL_BODY, operationMocks.executeGmailRemoveLabel, 'message'],
  ['gmail_remove_label_v2', LABEL_BODY, operationMocks.executeGmailRemoveLabel, 'message'],
  ['gmail_send', MAIL_BODY, operationMocks.executeGmailSend, 'mail'],
  ['gmail_send_v2', MAIL_BODY, operationMocks.executeGmailSend, 'mail'],
  ['gmail_unarchive', MESSAGE_BODY, operationMocks.executeGmailUnarchive, 'message'],
  ['gmail_unarchive_v2', MESSAGE_BODY, operationMocks.executeGmailUnarchive, 'message'],
] as const

describe('executeGmailTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(TOOL_CASES)(
    'validates and dispatches %s',
    async (toolId, input, operation, operationKind) => {
      const controller = new AbortController()
      operation.mockResolvedValue({ toolId })

      const response = await executeGmailTool(
        createRequest({ toolId, input, signal: controller.signal })
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ toolId })
      if (operationKind === 'mail') {
        expect(operation).toHaveBeenCalledWith(input, {
          requestId: 'request-1',
          signal: controller.signal,
          userId: 'user-1',
        })
      } else {
        expect(operation).toHaveBeenCalledWith(input, controller.signal)
      }
    }
  )

  it('returns the canonical validation envelope before provider work', async () => {
    const response = await executeGmailTool(
      createRequest({ input: { accessToken: '', messageId: '' } })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(operationMocks.executeGmailArchive).not.toHaveBeenCalled()
  })

  it('rejects non-object operation input', async () => {
    const response = await executeGmailTool(createRequest({ input: '{' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(operationMocks.executeGmailArchive).not.toHaveBeenCalled()
  })

  it('preserves typed provider status and error envelopes', async () => {
    operationMocks.executeGmailArchive.mockRejectedValue(
      new GmailOperationError('Gmail API error: Not Found', 404, {
        success: false,
        error: 'Gmail API error: Not Found',
      })
    )

    const response = await executeGmailTool(createRequest())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Gmail API error: Not Found',
    })
  })

  it('rejects unsupported Gmail IDs without provider work', async () => {
    const response = await executeGmailTool(createRequest({ toolId: 'gmail_unknown' }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Unsupported Gmail tool: gmail_unknown',
    })
    expect(operationMocks.executeGmailArchive).not.toHaveBeenCalled()
  })

  it('propagates cancellation without starting provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeGmailTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(operationMocks.executeGmailArchive).not.toHaveBeenCalled()
  })
})
