import { z } from 'zod'
import {
  credentialWorkflowDomainBodySchema,
  definePostSelector,
  idNameSchema,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractBody, ContractJsonResponse } from '@/lib/api/contracts/types'

const jsmBaseBodySchema = z.object({
  domain: z.string({ error: 'Domain is required' }).min(1, 'Domain is required'),
  accessToken: z.string({ error: 'Access token is required' }).min(1, 'Access token is required'),
  cloudId: z.string().optional(),
})

const jsmIssueIdOrKeyField = z
  .string({ error: 'Issue ID or key is required' })
  .min(1, 'Issue ID or key is required')

const jsmServiceDeskIdField = z
  .string({ error: 'Service Desk ID is required' })
  .min(1, 'Service Desk ID is required')

const jsmFormIdField = z.string({ error: 'Form ID is required' }).min(1, 'Form ID is required')

const jsmIdListSchema = z.union([z.string(), z.array(z.string())]).optional()

const jsmRequestTypesBodySchema = credentialWorkflowDomainBodySchema.extend({
  serviceDeskId: z.string().min(1),
})

const jsmServiceDesksBodySchema = jsmBaseBodySchema.extend({
  expand: z.string().optional(),
  start: z.string().optional(),
  limit: z.string().optional(),
})

const jsmServiceDeskScopedBodySchema = jsmBaseBodySchema.extend({
  serviceDeskId: jsmServiceDeskIdField,
  start: z.string().optional(),
  limit: z.string().optional(),
})

const jsmQueuesBodySchema = jsmServiceDeskScopedBodySchema.extend({
  includeCount: z.string().optional(),
})

const jsmRequestTypesToolBodySchema = jsmServiceDeskScopedBodySchema.extend({
  searchQuery: z.string().optional(),
  groupId: z.string().optional(),
  expand: z.string().optional(),
})

const jsmRequestTypeFieldsBodySchema = jsmBaseBodySchema.extend({
  serviceDeskId: jsmServiceDeskIdField,
  requestTypeId: z
    .string({ error: 'Request Type ID is required' })
    .min(1, 'Request Type ID is required'),
})

const jsmRequestsBodySchema = jsmBaseBodySchema.extend({
  serviceDeskId: z.string().optional(),
  requestOwnership: z.string().optional(),
  requestStatus: z.string().optional(),
  requestTypeId: z.string().optional(),
  searchTerm: z.string().optional(),
  expand: z.string().optional(),
  start: z.string().optional(),
  limit: z.string().optional(),
})

const jsmRequestBodySchema = jsmBaseBodySchema.extend({
  issueIdOrKey: z.string().optional(),
  serviceDeskId: z.string().optional(),
  requestTypeId: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  raiseOnBehalfOf: z.string().optional(),
  requestFieldValues: z.record(z.string(), z.unknown()).optional(),
  formAnswers: z.record(z.string(), z.unknown()).optional(),
  requestParticipants: z.union([z.string(), z.array(z.string())]).optional(),
  channel: z.string().optional(),
  expand: z.string().optional(),
})

const jsmCommentBodySchema = jsmBaseBodySchema.extend({
  issueIdOrKey: jsmIssueIdOrKeyField,
  body: z.string({ error: 'Comment body is required' }).min(1, 'Comment body is required'),
  isPublic: z.boolean().optional(),
})

const jsmCommentsBodySchema = jsmBaseBodySchema.extend({
  issueIdOrKey: jsmIssueIdOrKeyField,
  isPublic: z.boolean().optional(),
  internal: z.boolean().optional(),
  expand: z.string().optional(),
  start: z.string().optional(),
  limit: z.string().optional(),
})

const jsmTransitionBodySchema = jsmBaseBodySchema.extend({
  issueIdOrKey: jsmIssueIdOrKeyField,
  transitionId: z
    .string({ error: 'Transition ID is required' })
    .min(1, 'Transition ID is required'),
  comment: z.string().optional(),
})

const jsmIssuePaginationBodySchema = jsmBaseBodySchema.extend({
  issueIdOrKey: jsmIssueIdOrKeyField,
  start: z.string().optional(),
  limit: z.string().optional(),
})

const jsmApprovalsBodySchema = jsmBaseBodySchema.extend({
  action: z.string({ error: 'Action is required' }).min(1, 'Action is required'),
  issueIdOrKey: jsmIssueIdOrKeyField,
  approvalId: z.string().optional(),
  decision: z.string().optional(),
  start: z.string().optional(),
  limit: z.string().optional(),
})

const jsmParticipantsBodySchema = jsmBaseBodySchema.extend({
  action: z.string({ error: 'Action is required' }).min(1, 'Action is required'),
  issueIdOrKey: jsmIssueIdOrKeyField,
  accountIds: z.union([z.string(), z.array(z.string())]).optional(),
  start: z.string().optional(),
  limit: z.string().optional(),
})

const jsmCustomersBodySchema = jsmBaseBodySchema.extend({
  serviceDeskId: jsmServiceDeskIdField,
  query: z.string().optional(),
  start: z.string().optional(),
  limit: z.string().optional(),
  accountIds: jsmIdListSchema,
  emails: jsmIdListSchema,
})

const jsmOrganizationBodySchema = jsmBaseBodySchema.extend({
  action: z.string({ error: 'Action is required' }).min(1, 'Action is required'),
  name: z.string().optional(),
  serviceDeskId: z.string().optional(),
  organizationId: z.string().optional(),
})

const jsmIssueFormsBodySchema = jsmBaseBodySchema.extend({
  issueIdOrKey: jsmIssueIdOrKeyField,
})

const jsmIssueFormBodySchema = jsmIssueFormsBodySchema.extend({
  formId: jsmFormIdField,
})

const jsmAttachFormBodySchema = jsmIssueFormsBodySchema.extend({
  formTemplateId: z
    .string({ error: 'Form template ID is required' })
    .min(1, 'Form template ID is required'),
})

const jsmSaveFormAnswersBodySchema = jsmIssueFormBodySchema.extend({
  answers: z.custom<Record<string, unknown>>(
    (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
    { message: 'Answers object is required' }
  ),
})

const jsmProjectFormTemplatesBodySchema = jsmBaseBodySchema.extend({
  projectIdOrKey: z
    .string({ error: 'Project ID or key is required' })
    .min(1, 'Project ID or key is required'),
})

const jsmProjectFormStructureBodySchema = jsmProjectFormTemplatesBodySchema.extend({
  formId: jsmFormIdField,
})

const jsmCopyFormsBodySchema = jsmBaseBodySchema.extend({
  sourceIssueIdOrKey: z
    .string({ error: 'Source issue ID or key is required' })
    .min(1, 'Source issue ID or key is required'),
  targetIssueIdOrKey: z
    .string({ error: 'Target issue ID or key is required' })
    .min(1, 'Target issue ID or key is required'),
  formIds: z.array(z.string(), { error: 'formIds must be an array of form UUIDs' }).optional(),
})

const defineJsmToolContract = <TBody extends z.ZodType>(path: string, body: TBody) =>
  definePostSelector(path, body, z.unknown())

export const jsmServiceDesksSelectorContract = definePostSelector(
  '/api/tools/jsm/selector-servicedesks',
  credentialWorkflowDomainBodySchema,
  z.object({ serviceDesks: z.array(idNameSchema) })
)

export const jsmRequestTypesSelectorContract = definePostSelector(
  '/api/tools/jsm/selector-requesttypes',
  jsmRequestTypesBodySchema,
  z.object({ requestTypes: z.array(idNameSchema) })
)

export const jsmServiceDesksContract = defineJsmToolContract(
  '/api/tools/jsm/servicedesks',
  jsmServiceDesksBodySchema
)
export const jsmQueuesContract = defineJsmToolContract('/api/tools/jsm/queues', jsmQueuesBodySchema)
export const jsmRequestTypesContract = defineJsmToolContract(
  '/api/tools/jsm/requesttypes',
  jsmRequestTypesToolBodySchema
)
export const jsmRequestTypeFieldsContract = defineJsmToolContract(
  '/api/tools/jsm/requesttypefields',
  jsmRequestTypeFieldsBodySchema
)
export const jsmRequestsContract = defineJsmToolContract(
  '/api/tools/jsm/requests',
  jsmRequestsBodySchema
)
export const jsmRequestContract = defineJsmToolContract(
  '/api/tools/jsm/request',
  jsmRequestBodySchema
)
export const jsmCommentContract = defineJsmToolContract(
  '/api/tools/jsm/comment',
  jsmCommentBodySchema
)
export const jsmCommentsContract = defineJsmToolContract(
  '/api/tools/jsm/comments',
  jsmCommentsBodySchema
)
export const jsmTransitionContract = defineJsmToolContract(
  '/api/tools/jsm/transition',
  jsmTransitionBodySchema
)
export const jsmSlaContract = defineJsmToolContract(
  '/api/tools/jsm/sla',
  jsmIssuePaginationBodySchema
)
export const jsmTransitionsContract = defineJsmToolContract(
  '/api/tools/jsm/transitions',
  jsmIssuePaginationBodySchema
)
export const jsmApprovalsContract = defineJsmToolContract(
  '/api/tools/jsm/approvals',
  jsmApprovalsBodySchema
)
export const jsmParticipantsContract = defineJsmToolContract(
  '/api/tools/jsm/participants',
  jsmParticipantsBodySchema
)
export const jsmCustomersContract = defineJsmToolContract(
  '/api/tools/jsm/customers',
  jsmCustomersBodySchema
)
export const jsmOrganizationsContract = defineJsmToolContract(
  '/api/tools/jsm/organizations',
  jsmServiceDeskScopedBodySchema
)
export const jsmOrganizationContract = defineJsmToolContract(
  '/api/tools/jsm/organization',
  jsmOrganizationBodySchema
)
export const jsmIssueFormsContract = defineJsmToolContract(
  '/api/tools/jsm/forms/issue',
  jsmIssueFormsBodySchema
)
export const jsmAttachFormContract = defineJsmToolContract(
  '/api/tools/jsm/forms/attach',
  jsmAttachFormBodySchema
)
export const jsmGetFormContract = defineJsmToolContract(
  '/api/tools/jsm/forms/get',
  jsmIssueFormBodySchema
)
export const jsmSubmitFormContract = defineJsmToolContract(
  '/api/tools/jsm/forms/submit',
  jsmIssueFormBodySchema
)
export const jsmDeleteFormContract = defineJsmToolContract(
  '/api/tools/jsm/forms/delete',
  jsmIssueFormBodySchema
)
export const jsmExternaliseFormContract = defineJsmToolContract(
  '/api/tools/jsm/forms/externalise',
  jsmIssueFormBodySchema
)
export const jsmInternaliseFormContract = defineJsmToolContract(
  '/api/tools/jsm/forms/internalise',
  jsmIssueFormBodySchema
)
export const jsmReopenFormContract = defineJsmToolContract(
  '/api/tools/jsm/forms/reopen',
  jsmIssueFormBodySchema
)
export const jsmSaveFormAnswersContract = defineJsmToolContract(
  '/api/tools/jsm/forms/save',
  jsmSaveFormAnswersBodySchema
)
export const jsmFormAnswersContract = defineJsmToolContract(
  '/api/tools/jsm/forms/answers',
  jsmIssueFormBodySchema
)
export const jsmProjectFormTemplatesContract = defineJsmToolContract(
  '/api/tools/jsm/forms/templates',
  jsmProjectFormTemplatesBodySchema
)
export const jsmProjectFormStructureContract = defineJsmToolContract(
  '/api/tools/jsm/forms/structure',
  jsmProjectFormStructureBodySchema
)
export const jsmCopyFormsContract = defineJsmToolContract(
  '/api/tools/jsm/forms/copy',
  jsmCopyFormsBodySchema
)

type JsmServiceDesksBody = ContractBody<typeof jsmServiceDesksContract>
type JsmQueuesBody = ContractBody<typeof jsmQueuesContract>
type JsmRequestTypesBody = ContractBody<typeof jsmRequestTypesContract>
type JsmRequestTypeFieldsBody = ContractBody<typeof jsmRequestTypeFieldsContract>
type JsmRequestsBody = ContractBody<typeof jsmRequestsContract>
type JsmRequestBody = ContractBody<typeof jsmRequestContract>
type JsmCommentBody = ContractBody<typeof jsmCommentContract>
type JsmCommentsBody = ContractBody<typeof jsmCommentsContract>
type JsmTransitionBody = ContractBody<typeof jsmTransitionContract>
type JsmSlaBody = ContractBody<typeof jsmSlaContract>
type JsmTransitionsBody = ContractBody<typeof jsmTransitionsContract>
type JsmApprovalsBody = ContractBody<typeof jsmApprovalsContract>
type JsmParticipantsBody = ContractBody<typeof jsmParticipantsContract>
type JsmCustomersBody = ContractBody<typeof jsmCustomersContract>
type JsmOrganizationsBody = ContractBody<typeof jsmOrganizationsContract>
type JsmOrganizationBody = ContractBody<typeof jsmOrganizationContract>
type JsmIssueFormsBody = ContractBody<typeof jsmIssueFormsContract>
type JsmAttachFormBody = ContractBody<typeof jsmAttachFormContract>
type JsmGetFormBody = ContractBody<typeof jsmGetFormContract>
type JsmSubmitFormBody = ContractBody<typeof jsmSubmitFormContract>
type JsmDeleteFormBody = ContractBody<typeof jsmDeleteFormContract>
type JsmExternaliseFormBody = ContractBody<typeof jsmExternaliseFormContract>
type JsmInternaliseFormBody = ContractBody<typeof jsmInternaliseFormContract>
type JsmReopenFormBody = ContractBody<typeof jsmReopenFormContract>
type JsmSaveFormAnswersBody = ContractBody<typeof jsmSaveFormAnswersContract>
type JsmFormAnswersBody = ContractBody<typeof jsmFormAnswersContract>
type JsmProjectFormTemplatesBody = ContractBody<typeof jsmProjectFormTemplatesContract>
type JsmProjectFormStructureBody = ContractBody<typeof jsmProjectFormStructureContract>
type JsmCopyFormsBody = ContractBody<typeof jsmCopyFormsContract>
type JsmServiceDesksSelectorResponse = ContractJsonResponse<typeof jsmServiceDesksSelectorContract>
type JsmRequestTypesSelectorResponse = ContractJsonResponse<typeof jsmRequestTypesSelectorContract>
