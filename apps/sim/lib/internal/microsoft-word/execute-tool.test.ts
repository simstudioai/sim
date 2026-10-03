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
import { executeMicrosoftWordTool as executeMicrosoftWordToolOperation } from '@/lib/internal/microsoft-word/execute-tool'
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

async function executeMicrosoftWordTool(
  request: Parameters<typeof executeMicrosoftWordToolOperation>[0]
): Promise<Response> {
  const result = await executeMicrosoftWordToolOperation(request)
  if (!(result instanceof Response)) throw new Error('Expected a JSON response')
  return result
}

describe('executeMicrosoftWordTool', () => {
  beforeEach(() => {
    for (const operation of Object.values(operationMocks)) {
      operation.mockResolvedValue({ success: true, output: { handled: true } })
    }
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
})
