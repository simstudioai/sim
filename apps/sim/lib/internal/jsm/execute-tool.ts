import { getErrorMessage } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import {
  jsmApprovalsContract,
  jsmAttachFormContract,
  jsmCommentContract,
  jsmCommentsContract,
  jsmCopyFormsContract,
  jsmCreateObjectContract,
  jsmCustomersContract,
  jsmDeleteFormContract,
  jsmDeleteObjectContract,
  jsmExternaliseFormContract,
  jsmFormAnswersContract,
  jsmGetFormContract,
  jsmGetObjectContract,
  jsmGetObjectSchemaContract,
  jsmInternaliseFormContract,
  jsmIssueFormsContract,
  jsmListObjectSchemasContract,
  jsmListObjectTypesContract,
  jsmObjectTypeAttributesContract,
  jsmOrganizationContract,
  jsmOrganizationsContract,
  jsmParticipantsContract,
  jsmProjectFormStructureContract,
  jsmProjectFormTemplatesContract,
  jsmQueuesContract,
  jsmReopenFormContract,
  jsmRequestContract,
  jsmRequestsContract,
  jsmRequestTypeFieldsContract,
  jsmRequestTypesContract,
  jsmSaveFormAnswersContract,
  jsmSearchObjectsAqlContract,
  jsmServiceDesksContract,
  jsmSlaContract,
  jsmSubmitFormContract,
  jsmTransitionContract,
  jsmTransitionsContract,
  jsmUpdateObjectContract,
} from '@/lib/api/contracts/tools/jsm'
import {
  executeJsmCreateObject,
  executeJsmDeleteObject,
  executeJsmGetObject,
  executeJsmGetObjectSchema,
  executeJsmGetObjectTypeAttributes,
  executeJsmListObjectSchemas,
  executeJsmListObjectTypes,
  executeJsmSearchObjectsAql,
  executeJsmUpdateObject,
} from '@/lib/internal/jsm/assets'
import { JsmOperationError } from '@/lib/internal/jsm/errors'
import {
  executeJsmAttachForm,
  executeJsmCopyForms,
  executeJsmDeleteForm,
  executeJsmExternaliseForm,
  executeJsmGetForm,
  executeJsmGetFormAnswers,
  executeJsmGetFormStructure,
  executeJsmGetFormTemplates,
  executeJsmGetIssueForms,
  executeJsmInternaliseForm,
  executeJsmReopenForm,
  executeJsmSaveFormAnswers,
  executeJsmSubmitForm,
} from '@/lib/internal/jsm/forms'
import {
  executeJsmAddComment,
  executeJsmAddCustomer,
  executeJsmAddOrganization,
  executeJsmAddParticipants,
  executeJsmAnswerApproval,
  executeJsmCreateOrganization,
  executeJsmCreateRequest,
  executeJsmGetApprovals,
  executeJsmGetComments,
  executeJsmGetCustomers,
  executeJsmGetOrganizations,
  executeJsmGetParticipants,
  executeJsmGetQueues,
  executeJsmGetRequest,
  executeJsmGetRequests,
  executeJsmGetRequestTypeFields,
  executeJsmGetRequestTypes,
  executeJsmGetServiceDesks,
  executeJsmGetSla,
  executeJsmGetTransitions,
  executeJsmTransitionRequest,
} from '@/lib/internal/jsm/service-desk'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  execute: (input: ContractBody<C>, signal?: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal
): Promise<Response> {
  signal?.throwIfAborted()
  const parsed = parseInternalToolInput(contract, input)
  if (!parsed.success) return parsed.response
  try {
    const result = await execute(parsed.data, signal)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof JsmOperationError) {
      return Response.json(error.body ?? { error: error.message }, { status: error.status })
    }
    return Response.json(
      { error: getErrorMessage(error, 'Internal server error'), success: false },
      { status: 500 }
    )
  }
}

export const executeJsmTool: InternalToolOperationHandler = async ({ toolId, input, signal }) => {
  signal?.throwIfAborted()
  switch (toolId) {
    case 'jsm_get_service_desks':
      return executeOperation(jsmServiceDesksContract, input, executeJsmGetServiceDesks, signal)
    case 'jsm_get_queues':
      return executeOperation(jsmQueuesContract, input, executeJsmGetQueues, signal)
    case 'jsm_get_request_types':
      return executeOperation(jsmRequestTypesContract, input, executeJsmGetRequestTypes, signal)
    case 'jsm_get_request_type_fields':
      return executeOperation(
        jsmRequestTypeFieldsContract,
        input,
        executeJsmGetRequestTypeFields,
        signal
      )
    case 'jsm_get_requests':
      return executeOperation(jsmRequestsContract, input, executeJsmGetRequests, signal)
    case 'jsm_create_request':
      return executeOperation(jsmRequestContract, input, executeJsmCreateRequest, signal)
    case 'jsm_get_request':
      return executeOperation(jsmRequestContract, input, executeJsmGetRequest, signal)
    case 'jsm_add_comment':
      return executeOperation(jsmCommentContract, input, executeJsmAddComment, signal)
    case 'jsm_get_comments':
      return executeOperation(jsmCommentsContract, input, executeJsmGetComments, signal)
    case 'jsm_transition_request':
      return executeOperation(jsmTransitionContract, input, executeJsmTransitionRequest, signal)
    case 'jsm_get_transitions':
      return executeOperation(jsmTransitionsContract, input, executeJsmGetTransitions, signal)
    case 'jsm_get_sla':
      return executeOperation(jsmSlaContract, input, executeJsmGetSla, signal)
    case 'jsm_get_approvals':
      return executeOperation(jsmApprovalsContract, input, executeJsmGetApprovals, signal)
    case 'jsm_answer_approval':
      return executeOperation(jsmApprovalsContract, input, executeJsmAnswerApproval, signal)
    case 'jsm_get_participants':
      return executeOperation(jsmParticipantsContract, input, executeJsmGetParticipants, signal)
    case 'jsm_add_participants':
      return executeOperation(jsmParticipantsContract, input, executeJsmAddParticipants, signal)
    case 'jsm_get_customers':
      return executeOperation(jsmCustomersContract, input, executeJsmGetCustomers, signal)
    case 'jsm_add_customer':
      return executeOperation(jsmCustomersContract, input, executeJsmAddCustomer, signal)
    case 'jsm_get_organizations':
      return executeOperation(jsmOrganizationsContract, input, executeJsmGetOrganizations, signal)
    case 'jsm_create_organization':
      return executeOperation(jsmOrganizationContract, input, executeJsmCreateOrganization, signal)
    case 'jsm_add_organization':
      return executeOperation(jsmOrganizationContract, input, executeJsmAddOrganization, signal)
    case 'jsm_get_issue_forms':
      return executeOperation(jsmIssueFormsContract, input, executeJsmGetIssueForms, signal)
    case 'jsm_attach_form':
      return executeOperation(jsmAttachFormContract, input, executeJsmAttachForm, signal)
    case 'jsm_get_form':
      return executeOperation(jsmGetFormContract, input, executeJsmGetForm, signal)
    case 'jsm_submit_form':
      return executeOperation(jsmSubmitFormContract, input, executeJsmSubmitForm, signal)
    case 'jsm_delete_form':
      return executeOperation(jsmDeleteFormContract, input, executeJsmDeleteForm, signal)
    case 'jsm_externalise_form':
      return executeOperation(jsmExternaliseFormContract, input, executeJsmExternaliseForm, signal)
    case 'jsm_internalise_form':
      return executeOperation(jsmInternaliseFormContract, input, executeJsmInternaliseForm, signal)
    case 'jsm_reopen_form':
      return executeOperation(jsmReopenFormContract, input, executeJsmReopenForm, signal)
    case 'jsm_save_form_answers':
      return executeOperation(jsmSaveFormAnswersContract, input, executeJsmSaveFormAnswers, signal)
    case 'jsm_get_form_answers':
      return executeOperation(jsmFormAnswersContract, input, executeJsmGetFormAnswers, signal)
    case 'jsm_get_form_templates':
      return executeOperation(
        jsmProjectFormTemplatesContract,
        input,
        executeJsmGetFormTemplates,
        signal
      )
    case 'jsm_get_form_structure':
      return executeOperation(
        jsmProjectFormStructureContract,
        input,
        executeJsmGetFormStructure,
        signal
      )
    case 'jsm_copy_forms':
      return executeOperation(jsmCopyFormsContract, input, executeJsmCopyForms, signal)
    case 'jsm_list_object_schemas':
      return executeOperation(
        jsmListObjectSchemasContract,
        input,
        executeJsmListObjectSchemas,
        signal
      )
    case 'jsm_get_object_schema':
      return executeOperation(jsmGetObjectSchemaContract, input, executeJsmGetObjectSchema, signal)
    case 'jsm_list_object_types':
      return executeOperation(jsmListObjectTypesContract, input, executeJsmListObjectTypes, signal)
    case 'jsm_get_object_type_attributes':
      return executeOperation(
        jsmObjectTypeAttributesContract,
        input,
        executeJsmGetObjectTypeAttributes,
        signal
      )
    case 'jsm_search_objects_aql':
      return executeOperation(
        jsmSearchObjectsAqlContract,
        input,
        executeJsmSearchObjectsAql,
        signal
      )
    case 'jsm_get_object':
      return executeOperation(jsmGetObjectContract, input, executeJsmGetObject, signal)
    case 'jsm_create_object':
      return executeOperation(jsmCreateObjectContract, input, executeJsmCreateObject, signal)
    case 'jsm_update_object':
      return executeOperation(jsmUpdateObjectContract, input, executeJsmUpdateObject, signal)
    case 'jsm_delete_object':
      return executeOperation(jsmDeleteObjectContract, input, executeJsmDeleteObject, signal)
    default:
      return Response.json({ error: `Unsupported JSM tool: ${toolId}` }, { status: 500 })
  }
}
