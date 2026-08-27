/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operations = vi.hoisted(() => ({
  executeDocuSignCreateFromTemplate: vi.fn(),
  executeDocuSignDownloadDocument: vi.fn(),
  executeDocuSignGetEnvelope: vi.fn(),
  executeDocuSignListEnvelopes: vi.fn(),
  executeDocuSignListRecipients: vi.fn(),
  executeDocuSignListTemplates: vi.fn(),
  executeDocuSignSendEnvelope: vi.fn(),
  executeDocuSignVoidEnvelope: vi.fn(),
}))

vi.mock('@/lib/internal/docusign/operations', () => operations)

import { DocuSignOperationError } from '@/lib/internal/docusign/errors'
import { executeDocuSignTool } from '@/lib/internal/docusign/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const AUTH = { accessToken: 'access-token' }

function request(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'docusign_list_templates',
    input: AUTH,
    headers: new Headers(),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      workspaceId: 'workspace-1',
      userId: 'user-1',
      executionId: 'execution-1',
    },
    requestId: 'request-1',
    ...overrides,
  } as InternalToolOperationCall
}

const CASES = [
  [
    'docusign_create_from_template',
    { ...AUTH, templateId: 'template-1', templateRoles: '[]' },
    operations.executeDocuSignCreateFromTemplate,
  ],
  [
    'docusign_download_document',
    { ...AUTH, envelopeId: 'envelope-1' },
    operations.executeDocuSignDownloadDocument,
  ],
  [
    'docusign_get_envelope',
    { ...AUTH, envelopeId: 'envelope-1' },
    operations.executeDocuSignGetEnvelope,
  ],
  ['docusign_list_envelopes', AUTH, operations.executeDocuSignListEnvelopes],
  [
    'docusign_list_recipients',
    { ...AUTH, envelopeId: 'envelope-1' },
    operations.executeDocuSignListRecipients,
  ],
  ['docusign_list_templates', AUTH, operations.executeDocuSignListTemplates],
  [
    'docusign_send_envelope',
    { ...AUTH, emailSubject: 'Sign', signerEmail: 'a@example.com', signerName: 'A' },
    operations.executeDocuSignSendEnvelope,
  ],
  [
    'docusign_void_envelope',
    { ...AUTH, envelopeId: 'envelope-1', voidedReason: 'Cancelled' },
    operations.executeDocuSignVoidEnvelope,
  ],
] as const

describe('executeDocuSignTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(CASES)(
    'dispatches %s with trusted execution context',
    async (toolId, input, operation) => {
      const controller = new AbortController()
      operation.mockResolvedValue({ toolId })
      const response = await executeDocuSignTool(
        request({ toolId, input, signal: controller.signal })
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ toolId })
      expect(operation).toHaveBeenCalledWith(input, {
        requestId: 'request-1',
        signal: controller.signal,
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      })
    }
  )

  it('authenticates before validating input', async () => {
    const response = await executeDocuSignTool(
      request({ input: null, context: createExecutionContext({ workflowId: 'workflow-1' }) })
    )
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ success: false, error: 'Unauthorized' })
  })

  it('returns route-compatible validation errors', async () => {
    const response = await executeDocuSignTool(request({ input: {} }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ success: false })
    expect(operations.executeDocuSignListTemplates).not.toHaveBeenCalled()
  })

  it('preserves typed operation status and body', async () => {
    operations.executeDocuSignListTemplates.mockRejectedValue(
      new DocuSignOperationError('Rate limited', 429)
    )
    const response = await executeDocuSignTool(request())
    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({ success: false, error: 'Rate limited' })
  })

  it('stops before provider work after cancellation', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))
    await expect(executeDocuSignTool(request({ signal: controller.signal }))).rejects.toMatchObject(
      { name: 'AbortError' }
    )
    expect(operations.executeDocuSignListTemplates).not.toHaveBeenCalled()
  })
})
