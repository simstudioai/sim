/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => ({
  executeMicrosoftWordAppend: vi.fn(),
  executeMicrosoftWordCreate: vi.fn(),
  executeMicrosoftWordCreateFromTemplate: vi.fn(),
  executeMicrosoftWordExportPdf: vi.fn(),
  executeMicrosoftWordRead: vi.fn(),
  executeMicrosoftWordReplaceText: vi.fn(),
  executeMicrosoftWordUpdate: vi.fn(),
}))

vi.mock('@/lib/internal/microsoft-word/operations', () => operationMocks)

import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { GraphRequestError } from '@/lib/internal/microsoft-word/client'
import { executeMicrosoftWordTool } from '@/lib/internal/microsoft-word/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const READ_INPUT = { accessToken: 'token', documentId: 'document-1' }

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'microsoft_word_read',
    input: READ_INPUT,
    headers: new Headers(),
    context: createExecutionContext({ workflowId: 'workflow-1' }),
    requestId: 'request-1',
    ...overrides,
  }
}

const TOOL_CASES = [
  [
    'microsoft_word_append',
    { accessToken: 'token', documentId: 'document-1', content: 'Append' },
    operationMocks.executeMicrosoftWordAppend,
  ],
  [
    'microsoft_word_create',
    { accessToken: 'token', name: 'Document', content: 'Hello' },
    operationMocks.executeMicrosoftWordCreate,
  ],
  [
    'microsoft_word_create_from_template',
    { accessToken: 'token', templateDocumentId: 'template-1', name: 'Document' },
    operationMocks.executeMicrosoftWordCreateFromTemplate,
  ],
  [
    'microsoft_word_export_pdf',
    { accessToken: 'token', documentId: 'document-1' },
    operationMocks.executeMicrosoftWordExportPdf,
  ],
  ['microsoft_word_read', READ_INPUT, operationMocks.executeMicrosoftWordRead],
  [
    'microsoft_word_replace_text',
    { accessToken: 'token', documentId: 'document-1', findText: 'old', replaceText: 'new' },
    operationMocks.executeMicrosoftWordReplaceText,
  ],
  [
    'microsoft_word_update',
    { accessToken: 'token', documentId: 'document-1', content: 'Replacement' },
    operationMocks.executeMicrosoftWordUpdate,
  ],
] as const

describe('executeMicrosoftWordTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const operation of Object.values(operationMocks)) {
      operation.mockResolvedValue({ success: true, output: { handled: true } })
    }
  })

  it.each(TOOL_CASES)('validates and dispatches %s', async (toolId, input, operation) => {
    const controller = new AbortController()
    const response = await executeMicrosoftWordTool(
      createRequest({
        toolId,
        input,
        signal: controller.signal,
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, output: { handled: true } })
    expect(operation).toHaveBeenCalledWith(input, {
      requestId: 'request-1',
      signal: controller.signal,
    })
  })

  it('returns validation errors before provider work', async () => {
    const response = await executeMicrosoftWordTool(
      createRequest({ input: { accessToken: '', documentId: '' } })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(operationMocks.executeMicrosoftWordRead).not.toHaveBeenCalled()
  })

  it('rejects oversized typed inputs before provider work', async () => {
    const response = await executeMicrosoftWordTool(
      createRequest({
        toolId: 'microsoft_word_update',
        input: {
          accessToken: 'token',
          documentId: 'document-1',
          content: 'x'.repeat(DEFAULT_MAX_JSON_BODY_BYTES + 1),
        },
      })
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/maximum allowed size/),
    })
    expect(operationMocks.executeMicrosoftWordUpdate).not.toHaveBeenCalled()
  })

  it('preserves Microsoft Graph status and the tool error envelope', async () => {
    operationMocks.executeMicrosoftWordRead.mockRejectedValue(
      new GraphRequestError('Document not found', 404)
    )

    const response = await executeMicrosoftWordTool(createRequest())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Document not found',
    })
  })

  it('propagates cancellation before provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeMicrosoftWordTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(operationMocks.executeMicrosoftWordRead).not.toHaveBeenCalled()
  })

  it('rejects unsupported tool IDs without provider work', async () => {
    const response = await executeMicrosoftWordTool(
      createRequest({ toolId: 'microsoft_word_unknown' })
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Unsupported Microsoft Word tool: microsoft_word_unknown',
    })
    expect(operationMocks.executeMicrosoftWordRead).not.toHaveBeenCalled()
  })
})
