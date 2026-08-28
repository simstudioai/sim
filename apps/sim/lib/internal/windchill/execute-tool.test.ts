/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createExecutorPrincipalFromExecutionContext: vi.fn(),
  executeWindchillOperation: vi.fn(),
}))

vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.createExecutorPrincipalFromExecutionContext,
}))

vi.mock('@/lib/internal/windchill/operations', () => ({
  executeWindchillOperation: mocks.executeWindchillOperation,
}))

import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { WindchillProviderError } from '@/lib/internal/windchill/client'
import { executeWindchillTool } from '@/lib/internal/windchill/execute-tool'

const BASE = {
  baseUrl: 'https://windchill.example.com/Windchill/servlet/odata/v6',
  username: 'windchill-user',
  password: 'not-a-real-password',
}
const DOCUMENT_OID = 'OR:wt.doc.WTDocument:1'
const ATTACHMENT_OID = 'OR:wt.content.ApplicationData:1'
const FILE = { key: 'uploads/specification.pdf', name: 'specification.pdf', size: 3 }
const PRINCIPAL = {
  kind: 'delegated' as const,
  serviceId: 'executor',
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'delegation-1',
  audience: 'sim:windchill',
  issuedAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: new Date('2026-01-01T01:00:00.000Z'),
  delegationContext: {
    kind: 'workflow_execution' as const,
    workflowId: 'workflow-1',
    executionId: 'execution-1',
  },
}

const TOOL_CASES = [
  ['windchill_create_document', { name: 'Specification', containerOid: DOCUMENT_OID }],
  [
    'windchill_create_documents',
    { documents: [{ name: 'Specification', containerOid: DOCUMENT_OID }] },
  ],
  ['windchill_update_document', { documentOid: DOCUMENT_OID, attributes: { Custom: 'value' } }],
  [
    'windchill_update_common_properties',
    { documentOid: DOCUMENT_OID, commonProperties: { Name: 'Renamed' } },
  ],
  [
    'windchill_update_documents',
    { documents: [{ id: DOCUMENT_OID, attributes: { Custom: 'value' } }] },
  ],
  ['windchill_delete_document', { documentOid: DOCUMENT_OID }],
  ['windchill_delete_documents', { documentOids: [DOCUMENT_OID] }],
  ['windchill_check_out_document', { documentOid: DOCUMENT_OID }],
  ['windchill_check_out_documents', { documentOids: [DOCUMENT_OID] }],
  ['windchill_check_in_document', { documentOid: DOCUMENT_OID }],
  ['windchill_check_in_documents', { documentOids: [DOCUMENT_OID] }],
  ['windchill_undo_check_out_document', { documentOid: DOCUMENT_OID }],
  ['windchill_undo_check_out_documents', { documentOids: [DOCUMENT_OID] }],
  ['windchill_revise_document', { documentOid: DOCUMENT_OID }],
  ['windchill_revise_documents', { documentOids: [DOCUMENT_OID] }],
  [
    'windchill_set_lifecycle_state',
    { documentOid: DOCUMENT_OID, stateValue: 'RELEASED', stateDisplay: 'Released' },
  ],
  [
    'windchill_update_document_security_labels',
    { securityLabelUpdates: [{ id: DOCUMENT_OID, labels: { EXPORT_CONTROL: 'EAR99' } }] },
  ],
  ['windchill_download_primary_content', { documentOid: DOCUMENT_OID }],
  ['windchill_upload_primary_content', { documentOid: DOCUMENT_OID, primaryFile: FILE }],
  ['windchill_download_attachment', { documentOid: DOCUMENT_OID, attachmentOid: ATTACHMENT_OID }],
  ['windchill_upload_attachments', { documentOid: DOCUMENT_OID, attachmentFiles: [FILE] }],
] as const

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  const defaultBody = { ...BASE, operation: 'windchill_delete_document', documentOid: DOCUMENT_OID }
  return {
    toolId: 'windchill_delete_document',
    input: defaultBody,
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      workspaceId: 'workspace-1',
      executionId: 'execution-1',
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeWindchillTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createExecutorPrincipalFromExecutionContext.mockResolvedValue(PRINCIPAL)
  })

  it.each(TOOL_CASES)('authorizes, validates, and dispatches %s', async (toolId, input) => {
    const controller = new AbortController()
    const operationInput = { ...BASE, operation: toolId, ...input }
    const output = { operation: toolId, affectedIds: [DOCUMENT_OID] }
    mocks.executeWindchillOperation.mockResolvedValue(output)

    const response = await executeWindchillTool(
      createRequest({ toolId, input: operationInput, signal: controller.signal })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, output })
    expect(mocks.createExecutorPrincipalFromExecutionContext).toHaveBeenCalledWith({
      context: expect.objectContaining({
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        userId: 'user-1',
      }),
      audience: 'sim:windchill',
    })
    expect(mocks.executeWindchillOperation).toHaveBeenCalledWith(operationInput, {
      principal: PRINCIPAL,
      requestId: 'request-1',
      signal: controller.signal,
    })
  })

  it('authenticates before validating non-object input', async () => {
    const response = await executeWindchillTool(createRequest({ input: '{' }))

    expect(mocks.createExecutorPrincipalFromExecutionContext).toHaveBeenCalledOnce()
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Invalid input: expected object, received string',
    })
    expect(mocks.executeWindchillOperation).not.toHaveBeenCalled()
  })

  it('rejects a prepared body for a different operation before provider work', async () => {
    const response = await executeWindchillTool(
      createRequest({
        toolId: 'windchill_delete_document',
        input: {
          ...BASE,
          operation: 'windchill_revise_document',
          documentOid: DOCUMENT_OID,
        },
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Windchill request operation does not match the selected tool',
    })
    expect(mocks.executeWindchillOperation).not.toHaveBeenCalled()
  })

  it('preserves provider status and sanitizes sensitive error material', async () => {
    mocks.executeWindchillOperation.mockRejectedValue(
      new WindchillProviderError(
        'Request https://windchill.example.com/file?token=secret with Basic dXNlcjpwYXNz failed',
        409
      )
    )

    const response = await executeWindchillTool(createRequest())

    expect(response.status).toBe(409)
    const result = await response.json()
    expect(result.success).toBe(false)
    expect(result.error).not.toContain('token=secret')
    expect(result.error).not.toContain('dXNlcjpwYXNz')
  })

  it('propagates cancellation before authorization', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeWindchillTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.createExecutorPrincipalFromExecutionContext).not.toHaveBeenCalled()
  })
})
