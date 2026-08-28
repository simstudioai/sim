/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => {
  class SesOperationInputError extends Error {}

  return {
    SesOperationInputError,
    executeSesCreateConfigurationSet: vi.fn(),
    executeSesCreateEmailIdentity: vi.fn(),
    executeSesCreateTemplate: vi.fn(),
    executeSesDeleteEmailIdentity: vi.fn(),
    executeSesDeleteSuppressedDestination: vi.fn(),
    executeSesDeleteTemplate: vi.fn(),
    executeSesGetAccount: vi.fn(),
    executeSesGetEmailIdentity: vi.fn(),
    executeSesGetSuppressedDestination: vi.fn(),
    executeSesGetTemplate: vi.fn(),
    executeSesListIdentities: vi.fn(),
    executeSesListSuppressedDestinations: vi.fn(),
    executeSesListTemplates: vi.fn(),
    executeSesPutSuppressedDestination: vi.fn(),
    executeSesSendBulkEmail: vi.fn(),
    executeSesSendCustomVerificationEmail: vi.fn(),
    executeSesSendEmail: vi.fn(),
    executeSesSendTemplatedEmail: vi.fn(),
    executeSesUpdateTemplate: vi.fn(),
  }
})

vi.mock('@/lib/internal/ses/operations', () => operationMocks)

import { executeSesTool } from '@/lib/internal/ses/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const VALID_BODY = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
} as const

const SUPPORTED_TOOL_IDS = [
  'ses_create_configuration_set',
  'ses_create_email_identity',
  'ses_create_template',
  'ses_delete_email_identity',
  'ses_delete_suppressed_destination',
  'ses_delete_template',
  'ses_get_account',
  'ses_get_email_identity',
  'ses_get_suppressed_destination',
  'ses_get_template',
  'ses_list_identities',
  'ses_list_suppressed_destinations',
  'ses_list_templates',
  'ses_put_suppressed_destination',
  'ses_send_bulk_email',
  'ses_send_custom_verification_email',
  'ses_send_email',
  'ses_send_templated_email',
  'ses_update_template',
] as const

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'ses_get_account',
    input: VALID_BODY,
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

describe('executeSesTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validates and executes the matching SES operation with cancellation', async () => {
    const controller = new AbortController()
    operationMocks.executeSesGetAccount.mockResolvedValue({
      sendingEnabled: true,
      max24HourSend: 1000,
      maxSendRate: 10,
      sentLast24Hours: 25,
    })

    const response = await executeSesTool(createRequest({ signal: controller.signal }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      sendingEnabled: true,
      max24HourSend: 1000,
      maxSendRate: 10,
      sentLast24Hours: 25,
    })
    expect(operationMocks.executeSesGetAccount).toHaveBeenCalledWith(VALID_BODY, controller.signal)
  })

  it('returns the route-compatible contract validation envelope before provider work', async () => {
    const response = await executeSesTool(createRequest({ input: { region: 'us-east-1' } }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(operationMocks.executeSesGetAccount).not.toHaveBeenCalled()
  })

  it.each(SUPPORTED_TOOL_IDS)('recognizes the canonical tool ID %s', async (toolId) => {
    const response = await executeSesTool(createRequest({ toolId, input: {} }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Invalid request data' })
  })

  it('preserves the provider error envelope', async () => {
    operationMocks.executeSesGetAccount.mockRejectedValue(new Error('AWS rejected credentials'))

    const response = await executeSesTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to get account information: AWS rejected credentials',
    })
  })

  it('preserves operation-level 400 errors', async () => {
    operationMocks.executeSesSendBulkEmail.mockRejectedValue(
      new operationMocks.SesOperationInputError(
        'destinations must be a valid JSON array of destination objects'
      )
    )

    const response = await executeSesTool(
      createRequest({
        toolId: 'ses_send_bulk_email',
        input: {
          ...VALID_BODY,
          fromAddress: 'sender@example.com',
          templateName: 'template',
          destinations: '[]',
        },
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'destinations must be a valid JSON array of destination objects',
    })
  })

  it('propagates cancellation without converting it into a provider failure', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeSesTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(operationMocks.executeSesGetAccount).not.toHaveBeenCalled()
  })
})
