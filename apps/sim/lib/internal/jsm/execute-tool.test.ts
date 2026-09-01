/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JsmOperationError } from '@/lib/internal/jsm/errors'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import type { ExecutionContext } from '@/executor/types'

const operations = vi.hoisted(() => ({
  executeJsmAddComment: vi.fn(),
  executeJsmAddCustomer: vi.fn(),
  executeJsmAddOrganization: vi.fn(),
  executeJsmAddParticipants: vi.fn(),
  executeJsmAnswerApproval: vi.fn(),
  executeJsmAttachForm: vi.fn(),
  executeJsmCopyForms: vi.fn(),
  executeJsmCreateObject: vi.fn(),
  executeJsmCreateOrganization: vi.fn(),
  executeJsmCreateRequest: vi.fn(),
  executeJsmDeleteForm: vi.fn(),
  executeJsmDeleteObject: vi.fn(),
  executeJsmExternaliseForm: vi.fn(),
  executeJsmGetApprovals: vi.fn(),
  executeJsmGetComments: vi.fn(),
  executeJsmGetCustomers: vi.fn(),
  executeJsmGetForm: vi.fn(),
  executeJsmGetFormAnswers: vi.fn(),
  executeJsmGetFormStructure: vi.fn(),
  executeJsmGetFormTemplates: vi.fn(),
  executeJsmGetIssueForms: vi.fn(),
  executeJsmGetObject: vi.fn(),
  executeJsmGetObjectSchema: vi.fn(),
  executeJsmGetObjectTypeAttributes: vi.fn(),
  executeJsmGetOrganizations: vi.fn(),
  executeJsmGetParticipants: vi.fn(),
  executeJsmGetQueues: vi.fn(),
  executeJsmGetRequest: vi.fn(),
  executeJsmGetRequests: vi.fn(),
  executeJsmGetRequestTypeFields: vi.fn(),
  executeJsmGetRequestTypes: vi.fn(),
  executeJsmGetServiceDesks: vi.fn(),
  executeJsmGetSla: vi.fn(),
  executeJsmGetTransitions: vi.fn(),
  executeJsmInternaliseForm: vi.fn(),
  executeJsmListObjectSchemas: vi.fn(),
  executeJsmListObjectTypes: vi.fn(),
  executeJsmReopenForm: vi.fn(),
  executeJsmSaveFormAnswers: vi.fn(),
  executeJsmSearchObjectsAql: vi.fn(),
  executeJsmSubmitForm: vi.fn(),
  executeJsmTransitionRequest: vi.fn(),
  executeJsmUpdateObject: vi.fn(),
}))

vi.mock('@/lib/internal/jsm/assets', () => ({
  executeJsmCreateObject: operations.executeJsmCreateObject,
  executeJsmDeleteObject: operations.executeJsmDeleteObject,
  executeJsmGetObject: operations.executeJsmGetObject,
  executeJsmGetObjectSchema: operations.executeJsmGetObjectSchema,
  executeJsmGetObjectTypeAttributes: operations.executeJsmGetObjectTypeAttributes,
  executeJsmListObjectSchemas: operations.executeJsmListObjectSchemas,
  executeJsmListObjectTypes: operations.executeJsmListObjectTypes,
  executeJsmSearchObjectsAql: operations.executeJsmSearchObjectsAql,
  executeJsmUpdateObject: operations.executeJsmUpdateObject,
}))

vi.mock('@/lib/internal/jsm/forms', () => ({
  executeJsmAttachForm: operations.executeJsmAttachForm,
  executeJsmCopyForms: operations.executeJsmCopyForms,
  executeJsmDeleteForm: operations.executeJsmDeleteForm,
  executeJsmExternaliseForm: operations.executeJsmExternaliseForm,
  executeJsmGetForm: operations.executeJsmGetForm,
  executeJsmGetFormAnswers: operations.executeJsmGetFormAnswers,
  executeJsmGetFormStructure: operations.executeJsmGetFormStructure,
  executeJsmGetFormTemplates: operations.executeJsmGetFormTemplates,
  executeJsmGetIssueForms: operations.executeJsmGetIssueForms,
  executeJsmInternaliseForm: operations.executeJsmInternaliseForm,
  executeJsmReopenForm: operations.executeJsmReopenForm,
  executeJsmSaveFormAnswers: operations.executeJsmSaveFormAnswers,
  executeJsmSubmitForm: operations.executeJsmSubmitForm,
}))

vi.mock('@/lib/internal/jsm/service-desk', () => ({
  executeJsmAddComment: operations.executeJsmAddComment,
  executeJsmAddCustomer: operations.executeJsmAddCustomer,
  executeJsmAddOrganization: operations.executeJsmAddOrganization,
  executeJsmAddParticipants: operations.executeJsmAddParticipants,
  executeJsmAnswerApproval: operations.executeJsmAnswerApproval,
  executeJsmCreateOrganization: operations.executeJsmCreateOrganization,
  executeJsmCreateRequest: operations.executeJsmCreateRequest,
  executeJsmGetApprovals: operations.executeJsmGetApprovals,
  executeJsmGetComments: operations.executeJsmGetComments,
  executeJsmGetCustomers: operations.executeJsmGetCustomers,
  executeJsmGetOrganizations: operations.executeJsmGetOrganizations,
  executeJsmGetParticipants: operations.executeJsmGetParticipants,
  executeJsmGetQueues: operations.executeJsmGetQueues,
  executeJsmGetRequest: operations.executeJsmGetRequest,
  executeJsmGetRequests: operations.executeJsmGetRequests,
  executeJsmGetRequestTypeFields: operations.executeJsmGetRequestTypeFields,
  executeJsmGetRequestTypes: operations.executeJsmGetRequestTypes,
  executeJsmGetServiceDesks: operations.executeJsmGetServiceDesks,
  executeJsmGetSla: operations.executeJsmGetSla,
  executeJsmGetTransitions: operations.executeJsmGetTransitions,
  executeJsmTransitionRequest: operations.executeJsmTransitionRequest,
}))

import { executeJsmTool } from '@/lib/internal/jsm/execute-tool'

const BASE = {
  domain: 'example.atlassian.net',
  accessToken: 'token',
  cloudId: '12345678-1234-1234-1234-123456789012',
}
const ISSUE = { ...BASE, issueIdOrKey: 'HELP-1' }
const FORM = { ...ISSUE, formId: '12345678-1234-1234-1234-123456789012' }
const ASSETS = { ...BASE, workspaceId: '12345678-1234-1234-1234-123456789012' }

type OperationName = keyof typeof operations

interface DispatchCase {
  toolId: string
  operation: OperationName
  input: Record<string, unknown>
}

const CASES: DispatchCase[] = [
  { toolId: 'jsm_get_service_desks', operation: 'executeJsmGetServiceDesks', input: BASE },
  {
    toolId: 'jsm_get_queues',
    operation: 'executeJsmGetQueues',
    input: { ...BASE, serviceDeskId: '1' },
  },
  {
    toolId: 'jsm_get_request_types',
    operation: 'executeJsmGetRequestTypes',
    input: { ...BASE, serviceDeskId: '1' },
  },
  {
    toolId: 'jsm_get_request_type_fields',
    operation: 'executeJsmGetRequestTypeFields',
    input: { ...BASE, serviceDeskId: '1', requestTypeId: '2' },
  },
  { toolId: 'jsm_get_requests', operation: 'executeJsmGetRequests', input: BASE },
  {
    toolId: 'jsm_create_request',
    operation: 'executeJsmCreateRequest',
    input: { ...BASE, serviceDeskId: '1', requestTypeId: '2', summary: 'Help' },
  },
  { toolId: 'jsm_get_request', operation: 'executeJsmGetRequest', input: ISSUE },
  {
    toolId: 'jsm_add_comment',
    operation: 'executeJsmAddComment',
    input: { ...ISSUE, body: 'Update' },
  },
  { toolId: 'jsm_get_comments', operation: 'executeJsmGetComments', input: ISSUE },
  {
    toolId: 'jsm_transition_request',
    operation: 'executeJsmTransitionRequest',
    input: { ...ISSUE, transitionId: '3' },
  },
  { toolId: 'jsm_get_transitions', operation: 'executeJsmGetTransitions', input: ISSUE },
  { toolId: 'jsm_get_sla', operation: 'executeJsmGetSla', input: ISSUE },
  {
    toolId: 'jsm_get_approvals',
    operation: 'executeJsmGetApprovals',
    input: { ...ISSUE, action: 'get' },
  },
  {
    toolId: 'jsm_answer_approval',
    operation: 'executeJsmAnswerApproval',
    input: { ...ISSUE, action: 'answer', approvalId: '4', decision: 'approve' },
  },
  {
    toolId: 'jsm_get_participants',
    operation: 'executeJsmGetParticipants',
    input: { ...ISSUE, action: 'get' },
  },
  {
    toolId: 'jsm_add_participants',
    operation: 'executeJsmAddParticipants',
    input: { ...ISSUE, action: 'add', accountIds: ['account-1'] },
  },
  {
    toolId: 'jsm_get_customers',
    operation: 'executeJsmGetCustomers',
    input: { ...BASE, serviceDeskId: '1' },
  },
  {
    toolId: 'jsm_add_customer',
    operation: 'executeJsmAddCustomer',
    input: { ...BASE, serviceDeskId: '1', accountIds: ['account-1'] },
  },
  {
    toolId: 'jsm_get_organizations',
    operation: 'executeJsmGetOrganizations',
    input: { ...BASE, serviceDeskId: '1' },
  },
  {
    toolId: 'jsm_create_organization',
    operation: 'executeJsmCreateOrganization',
    input: { ...BASE, action: 'create', name: 'Acme' },
  },
  {
    toolId: 'jsm_add_organization',
    operation: 'executeJsmAddOrganization',
    input: { ...BASE, action: 'add_to_service_desk', serviceDeskId: '1', organizationId: '2' },
  },
  { toolId: 'jsm_get_issue_forms', operation: 'executeJsmGetIssueForms', input: ISSUE },
  {
    toolId: 'jsm_attach_form',
    operation: 'executeJsmAttachForm',
    input: { ...ISSUE, formTemplateId: FORM.formId },
  },
  { toolId: 'jsm_get_form', operation: 'executeJsmGetForm', input: FORM },
  { toolId: 'jsm_submit_form', operation: 'executeJsmSubmitForm', input: FORM },
  { toolId: 'jsm_delete_form', operation: 'executeJsmDeleteForm', input: FORM },
  { toolId: 'jsm_externalise_form', operation: 'executeJsmExternaliseForm', input: FORM },
  { toolId: 'jsm_internalise_form', operation: 'executeJsmInternaliseForm', input: FORM },
  { toolId: 'jsm_reopen_form', operation: 'executeJsmReopenForm', input: FORM },
  {
    toolId: 'jsm_save_form_answers',
    operation: 'executeJsmSaveFormAnswers',
    input: { ...FORM, answers: { q1: 'Yes' } },
  },
  { toolId: 'jsm_get_form_answers', operation: 'executeJsmGetFormAnswers', input: FORM },
  {
    toolId: 'jsm_get_form_templates',
    operation: 'executeJsmGetFormTemplates',
    input: { ...BASE, projectIdOrKey: 'HELP' },
  },
  {
    toolId: 'jsm_get_form_structure',
    operation: 'executeJsmGetFormStructure',
    input: { ...BASE, projectIdOrKey: 'HELP', formId: FORM.formId },
  },
  {
    toolId: 'jsm_copy_forms',
    operation: 'executeJsmCopyForms',
    input: { ...BASE, sourceIssueIdOrKey: 'HELP-1', targetIssueIdOrKey: 'HELP-2' },
  },
  { toolId: 'jsm_list_object_schemas', operation: 'executeJsmListObjectSchemas', input: ASSETS },
  {
    toolId: 'jsm_get_object_schema',
    operation: 'executeJsmGetObjectSchema',
    input: { ...ASSETS, schemaId: '1' },
  },
  {
    toolId: 'jsm_list_object_types',
    operation: 'executeJsmListObjectTypes',
    input: { ...ASSETS, schemaId: '1' },
  },
  {
    toolId: 'jsm_get_object_type_attributes',
    operation: 'executeJsmGetObjectTypeAttributes',
    input: { ...ASSETS, objectTypeId: '1' },
  },
  {
    toolId: 'jsm_search_objects_aql',
    operation: 'executeJsmSearchObjectsAql',
    input: { ...ASSETS, qlQuery: 'objectType = Host' },
  },
  {
    toolId: 'jsm_get_object',
    operation: 'executeJsmGetObject',
    input: { ...ASSETS, objectId: '1' },
  },
  {
    toolId: 'jsm_create_object',
    operation: 'executeJsmCreateObject',
    input: {
      ...ASSETS,
      objectTypeId: '1',
      attributes: [{ objectTypeAttributeId: '2', objectAttributeValues: [{ value: 'host' }] }],
    },
  },
  {
    toolId: 'jsm_update_object',
    operation: 'executeJsmUpdateObject',
    input: {
      ...ASSETS,
      objectId: '1',
      attributes: [{ objectTypeAttributeId: '2', objectAttributeValues: [{ value: 'host' }] }],
    },
  },
  {
    toolId: 'jsm_delete_object',
    operation: 'executeJsmDeleteObject',
    input: { ...ASSETS, objectId: '1' },
  },
]

function request(
  toolId: string,
  input: Record<string, unknown>,
  signal?: AbortSignal
): InternalToolOperationCall {
  return {
    toolId,
    input,
    headers: new Headers(),
    context: { workflowId: 'workflow-1', userId: 'user-1' } as ExecutionContext,
    requestId: 'request-1',
    signal,
  }
}

describe('executeJsmTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const [operation, mock] of Object.entries(operations)) {
      mock.mockResolvedValue({ operation })
    }
  })

  it('covers all 43 canonical JSM tools', () => {
    expect(CASES).toHaveLength(43)
    expect(new Set(CASES.map(({ toolId }) => toolId)).size).toBe(43)
  })

  it.each(CASES)('dispatches $toolId through $operation', async ({ toolId, operation, input }) => {
    const response = await executeJsmTool(request(toolId, input))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ operation })
    expect(operations[operation]).toHaveBeenCalledWith(expect.objectContaining(input), undefined)
  })

  it('preserves typed provider errors', async () => {
    operations.executeJsmGetServiceDesks.mockRejectedValueOnce(
      new JsmOperationError('Rejected', 429, { error: 'Rejected', details: 'rate limited' })
    )
    const response = await executeJsmTool(request('jsm_get_service_desks', BASE))
    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ error: 'Rejected', details: 'rate limited' })
  })

  it('returns canonical input validation errors', async () => {
    const invalidInput = request('jsm_get_service_desks', BASE)
    invalidInput.input = '{'
    const invalidInputResponse = await executeJsmTool(invalidInput)
    expect(invalidInputResponse.status).toBe(400)
    expect(await invalidInputResponse.json()).toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    const validation = await executeJsmTool(request('jsm_get_service_desks', {}))
    expect(validation.status).toBe(400)
    expect(await validation.json()).toMatchObject({ error: 'Invalid request data' })
  })

  it('stops before dispatch when cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      executeJsmTool(request('jsm_get_service_desks', BASE, controller.signal))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(operations.executeJsmGetServiceDesks).not.toHaveBeenCalled()
  })

  it('returns an explicit error for unknown tools', async () => {
    const response = await executeJsmTool(request('jsm_unknown', BASE))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Unsupported JSM tool: jsm_unknown' })
  })
})
