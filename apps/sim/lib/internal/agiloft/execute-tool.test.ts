/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => ({
  executeAgiloftAsyncStatus: vi.fn(),
  executeAgiloftAttachFile: vi.fn(),
  executeAgiloftAttachmentInfo: vi.fn(),
  executeAgiloftCreateRecord: vi.fn(),
  executeAgiloftDeleteRecord: vi.fn(),
  executeAgiloftGetChoiceLineId: vi.fn(),
  executeAgiloftListTables: vi.fn(),
  executeAgiloftLockRecord: vi.fn(),
  executeAgiloftNlpSearch: vi.fn(),
  executeAgiloftReadRecord: vi.fn(),
  executeAgiloftRemoveAttachment: vi.fn(),
  executeAgiloftRetrieveAttachment: vi.fn(),
  executeAgiloftRunActionButton: vi.fn(),
  executeAgiloftSavedSearch: vi.fn(),
  executeAgiloftSearchRecords: vi.fn(),
  executeAgiloftSelectRecords: vi.fn(),
  executeAgiloftUpdateRecord: vi.fn(),
  executeAgiloftUpsertRecord: vi.fn(),
}))

vi.mock('@/lib/internal/agiloft/operations', () => operationMocks)

import { AgiloftOperationError } from '@/lib/internal/agiloft/errors'
import { executeAgiloftTool } from '@/lib/internal/agiloft/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const CREDENTIALS = {
  instanceUrl: 'https://example.agiloft.com',
  knowledgeBase: 'demo',
  login: 'user',
  password: 'not-a-real-password',
}

const BASE = {
  ...CREDENTIALS,
  table: 'contracts',
}

const FILE = {
  id: 'file-1',
  name: 'evidence.txt',
  key: 'workspace-1/file-1',
  size: 5,
  type: 'text/plain',
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'agiloft_create_record',
    input: { ...BASE, data: '{"name":"Contract"}' },
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      workspaceId: 'workspace-1',
      userId: 'user-current',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

const TOOL_CASES = [
  [
    'agiloft_async_status',
    { ...BASE, callbackId: 'callback-1' },
    operationMocks.executeAgiloftAsyncStatus,
  ],
  [
    'agiloft_attach_file',
    { ...BASE, recordId: '1', fieldName: 'files', file: FILE },
    operationMocks.executeAgiloftAttachFile,
  ],
  [
    'agiloft_attachment_info',
    { ...BASE, recordId: '1', fieldName: 'files' },
    operationMocks.executeAgiloftAttachmentInfo,
  ],
  [
    'agiloft_create_record',
    { ...BASE, data: '{"name":"Contract"}' },
    operationMocks.executeAgiloftCreateRecord,
  ],
  ['agiloft_delete_record', { ...BASE, recordId: '1' }, operationMocks.executeAgiloftDeleteRecord],
  [
    'agiloft_get_choice_line_id',
    { ...BASE, fieldName: 'status', value: 'Open' },
    operationMocks.executeAgiloftGetChoiceLineId,
  ],
  ['agiloft_list_tables', BASE, operationMocks.executeAgiloftListTables],
  [
    'agiloft_lock_record',
    { ...BASE, recordId: '1', lockAction: 'check' },
    operationMocks.executeAgiloftLockRecord,
  ],
  [
    'agiloft_nlp_search',
    { ...CREDENTIALS, nlpQuery: 'open contracts', fields: 'id,summary' },
    operationMocks.executeAgiloftNlpSearch,
  ],
  ['agiloft_read_record', { ...BASE, recordId: '1' }, operationMocks.executeAgiloftReadRecord],
  [
    'agiloft_remove_attachment',
    { ...BASE, recordId: '1', fieldName: 'files', position: '0' },
    operationMocks.executeAgiloftRemoveAttachment,
  ],
  [
    'agiloft_retrieve_attachment',
    { ...BASE, recordId: '1', fieldName: 'files', position: '0' },
    operationMocks.executeAgiloftRetrieveAttachment,
  ],
  [
    'agiloft_run_action_button',
    { ...BASE, recordId: '1', actionButtonField: 'approve' },
    operationMocks.executeAgiloftRunActionButton,
  ],
  ['agiloft_saved_search', BASE, operationMocks.executeAgiloftSavedSearch],
  [
    'agiloft_search_records',
    { ...BASE, query: 'status=Open' },
    operationMocks.executeAgiloftSearchRecords,
  ],
  [
    'agiloft_select_records',
    { ...BASE, where: 'status=Open' },
    operationMocks.executeAgiloftSelectRecords,
  ],
  [
    'agiloft_update_record',
    { ...BASE, recordId: '1', data: '{"name":"Updated"}' },
    operationMocks.executeAgiloftUpdateRecord,
  ],
  [
    'agiloft_upsert_record',
    { ...BASE, match: 'external_id', data: '{"external_id":"1"}' },
    operationMocks.executeAgiloftUpsertRecord,
  ],
] as const

describe('executeAgiloftTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const operation of Object.values(operationMocks)) {
      operation.mockResolvedValue({ success: true, output: { handled: true } })
    }
  })

  it.each(TOOL_CASES)('validates and dispatches %s', async (toolId, input, operation) => {
    const response = await executeAgiloftTool(createRequest({ toolId, input }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, output: { handled: true } })
    expect(operation).toHaveBeenCalledWith(
      expect.objectContaining(input),
      expect.objectContaining({ requestId: 'request-1', userId: 'user-current' })
    )
  })

  it('uses the trusted delegation origin and forwards cancellation', async () => {
    const controller = new AbortController()
    const input = { ...BASE, data: '{"name":"Contract"}' }

    await executeAgiloftTool(
      createRequest({
        input,
        signal: controller.signal,
        context: {
          ...createExecutionContext({ workflowId: 'workflow-current' }),
          workspaceId: 'workspace-1',
          userId: 'user-current',
          executorDelegationOrigin: {
            subjectUserId: 'user-origin',
            workflowId: 'workflow-origin',
            executionId: 'execution-origin',
          },
        },
      })
    )

    expect(operationMocks.executeAgiloftCreateRecord).toHaveBeenCalledWith(input, {
      requestId: 'request-1',
      userId: 'user-origin',
      signal: controller.signal,
    })
  })

  it('preserves non-object input and canonical validation envelopes', async () => {
    const invalidInput = await executeAgiloftTool(createRequest({ input: '{' }))
    expect(invalidInput.status).toBe(400)
    await expect(invalidInput.json()).resolves.toMatchObject({
      success: false,
      error: 'Invalid input: expected object, received string',
      details: expect.any(Array),
    })

    const invalidBody = await executeAgiloftTool(createRequest({ input: { ...BASE, data: '' } }))
    expect(invalidBody.status).toBe(400)
    await expect(invalidBody.json()).resolves.toMatchObject({
      success: false,
      error: 'Data is required',
      details: expect.any(Array),
    })
    expect(operationMocks.executeAgiloftCreateRecord).not.toHaveBeenCalled()
  })

  it('preserves explicit operation and generic provider errors', async () => {
    operationMocks.executeAgiloftCreateRecord.mockRejectedValueOnce(
      new AgiloftOperationError(429, { success: false, error: 'rate limited' })
    )
    const provider = await executeAgiloftTool(createRequest())
    expect(provider.status).toBe(429)
    await expect(provider.json()).resolves.toEqual({ success: false, error: 'rate limited' })

    operationMocks.executeAgiloftCreateRecord.mockRejectedValueOnce(new Error('network down'))
    const generic = await executeAgiloftTool(createRequest())
    expect(generic.status).toBe(500)
    await expect(generic.json()).resolves.toEqual({ success: false, error: 'network down' })
  })

  it('propagates cancellation before provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeAgiloftTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(operationMocks.executeAgiloftCreateRecord).not.toHaveBeenCalled()
  })

  it('returns a deterministic error for unsupported IDs', async () => {
    const response = await executeAgiloftTool(createRequest({ toolId: 'agiloft_unknown' }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Unsupported Agiloft tool: agiloft_unknown',
    })
  })
})
