/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => ({
  executeOutlookCopy: vi.fn(),
  executeOutlookDelete: vi.fn(),
  executeOutlookDraft: vi.fn(),
  executeOutlookGetAttachment: vi.fn(),
  executeOutlookMarkRead: vi.fn(),
  executeOutlookMarkUnread: vi.fn(),
  executeOutlookMove: vi.fn(),
  executeOutlookSend: vi.fn(),
}))

vi.mock('@/lib/internal/outlook/operations', () => operationMocks)

import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { OutlookOperationError } from '@/lib/internal/outlook/errors'
import { executeOutlookTool as executeOutlookToolOperation } from '@/lib/internal/outlook/execute-tool'
import { createInternalToolFileResult } from '@/lib/internal/tool-operations/file-result'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

async function executeOutlookTool(request: InternalToolOperationCall): Promise<Response> {
  const result = await executeOutlookToolOperation(request)
  if (!(result instanceof Response)) throw new Error('Expected a JSON response')
  return result
}

const MESSAGE_BODY = { accessToken: 'access-token', messageId: 'message-1' }
const COPY_MOVE_BODY = { ...MESSAGE_BODY, destinationId: 'folder-1' }
const MAIL_BODY = {
  accessToken: 'access-token',
  to: 'recipient@example.com',
  subject: 'Hello',
  body: 'Message body',
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'outlook_copy',
    input: COPY_MOVE_BODY,
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
  ['outlook_copy', COPY_MOVE_BODY, operationMocks.executeOutlookCopy, 'provider'],
  ['outlook_delete', MESSAGE_BODY, operationMocks.executeOutlookDelete, 'provider'],
  ['outlook_draft', MAIL_BODY, operationMocks.executeOutlookDraft, 'mail'],
  [
    'outlook_get_attachment',
    { ...MESSAGE_BODY, attachmentId: 'attachment-1' },
    operationMocks.executeOutlookGetAttachment,
    'provider',
  ],
  ['outlook_mark_read', MESSAGE_BODY, operationMocks.executeOutlookMarkRead, 'provider'],
  ['outlook_mark_unread', MESSAGE_BODY, operationMocks.executeOutlookMarkUnread, 'provider'],
  ['outlook_move', COPY_MOVE_BODY, operationMocks.executeOutlookMove, 'provider'],
  ['outlook_send', MAIL_BODY, operationMocks.executeOutlookSend, 'mail'],
] as const

describe('executeOutlookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(TOOL_CASES)(
    'validates and dispatches %s',
    async (toolId, input, operation, operationKind) => {
      const controller = new AbortController()
      operation.mockResolvedValue({ success: true, output: { toolId } })

      const response = await executeOutlookTool(
        createRequest({ toolId, input, signal: controller.signal })
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ success: true, output: { toolId } })
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

  it('passes large attachment bytes to the central presenter without serializing them', async () => {
    const buffer = Buffer.alloc(12 * 1024 * 1024)
    const fileResult = createInternalToolFileResult(
      { buffer, name: 'report.xlsx', mimeType: 'application/octet-stream' },
      (file) => ({ success: true, output: { attachments: [file] } })
    )
    operationMocks.executeOutlookGetAttachment.mockResolvedValue(fileResult)

    const result = await executeOutlookToolOperation(
      createRequest({
        toolId: 'outlook_get_attachment',
        input: { ...MESSAGE_BODY, attachmentId: 'attachment-1' },
      })
    )

    expect(result).toBe(fileResult)
  })

  it('rejects invalid attachment IDs before provider work', async () => {
    const response = await executeOutlookTool(
      createRequest({
        toolId: 'outlook_get_attachment',
        input: { ...MESSAGE_BODY, attachmentId: ' ' },
      })
    )

    expect(response.status).toBe(400)
    expect(operationMocks.executeOutlookGetAttachment).not.toHaveBeenCalled()
  })

  it('preserves attachment size errors as 413 responses', async () => {
    operationMocks.executeOutlookGetAttachment.mockRejectedValue(
      new OutlookOperationError('Outlook attachment exceeds the size limit', 413)
    )

    const response = await executeOutlookTool(
      createRequest({
        toolId: 'outlook_get_attachment',
        input: { ...MESSAGE_BODY, attachmentId: 'attachment-1' },
      })
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Outlook attachment exceeds the size limit',
    })
  })

  it('returns the canonical validation envelope before provider work', async () => {
    const response = await executeOutlookTool(
      createRequest({ input: { accessToken: '', messageId: '' } })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(operationMocks.executeOutlookCopy).not.toHaveBeenCalled()
  })

  it('rejects non-object operation input', async () => {
    const response = await executeOutlookTool(createRequest({ input: '{' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(operationMocks.executeOutlookCopy).not.toHaveBeenCalled()
  })

  it('rejects oversized bodies before parsing or provider work', async () => {
    const response = await executeOutlookTool(
      createRequest({ input: { body: ' '.repeat(DEFAULT_MAX_JSON_BODY_BYTES + 1) } })
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
    })
    expect(operationMocks.executeOutlookCopy).not.toHaveBeenCalled()
  })

  it('preserves provider status and error envelopes', async () => {
    operationMocks.executeOutlookCopy.mockRejectedValue(
      new OutlookOperationError('Message not found', 404)
    )

    const response = await executeOutlookTool(createRequest())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Message not found',
    })
  })

  it('preserves unexpected errors', async () => {
    operationMocks.executeOutlookCopy.mockRejectedValue(new Error('Microsoft unavailable'))

    const response = await executeOutlookTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Microsoft unavailable',
    })
  })

  it('rejects unsupported Outlook IDs without provider work', async () => {
    const response = await executeOutlookTool(createRequest({ toolId: 'outlook_unknown' }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Unsupported Outlook tool: outlook_unknown',
    })
    expect(operationMocks.executeOutlookCopy).not.toHaveBeenCalled()
  })

  it('propagates cancellation without starting provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeOutlookTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(operationMocks.executeOutlookCopy).not.toHaveBeenCalled()
  })
})
