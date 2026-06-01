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

export const jsmRequestTypesBodySchema = credentialWorkflowDomainBodySchema.extend({
  serviceDeskId: z.string().min(1),
})

export const jsmServiceDesksBodySchema = jsmBaseBodySchema.extend({
  expand: z.string().optional(),
  start: z.string().optional(),
  limit: z.string().optional(),
})

export const jsmServiceDeskScopedBodySchema = jsmBaseBodySchema.extend({
  serviceDeskId: jsmServiceDeskIdField,
  start: z.string().optional(),
  limit: z.string().optional(),
})

export const jsmQueuesBodySchema = jsmServiceDeskScopedBodySchema.extend({
  includeCount: z.string().optional(),
})

export const jsmRequestTypesToolBodySchema = jsmServiceDeskScopedBodySchema.extend({
  searchQuery: z.string().optional(),
  groupId: z.string().optional(),
  expand: z.string().optional(),
})

export const jsmRequestTypeFieldsBodySchema = jsmBaseBodySchema.extend({
  serviceDeskId: jsmServiceDeskIdField,
  requestTypeId: z
    .string({ error: 'Request Type ID is required' })
    .min(1, 'Request Type ID is required'),
})

export const jsmRequestsBodySchema = jsmBaseBodySchema.extend({
  serviceDeskId: z.string().optional(),
  requestOwnership: z.string().optional(),
  requestStatus: z.string().optional(),
  requestTypeId: z.string().optional(),
  searchTerm: z.string().optional(),
  expand: z.string().optional(),
  start: z.string().optional(),
  limit: z.string().optional(),
})

export const jsmRequestBodySchema = jsmBaseBodySchema.extend({
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

export const jsmCommentBodySchema = jsmBaseBodySchema.extend({
  issueIdOrKey: jsmIssueIdOrKeyField,
  body: z.string({ error: 'Comment body is required' }).min(1, 'Comment body is required'),
  isPublic: z.boolean().optional(),
})

export const jsmCommentsBodySchema = jsmBaseBodySchema.extend({
  issueIdOrKey: jsmIssueIdOrKeyField,
  isPublic: z.boolean().optional(),
  internal: z.boolean().optional(),
  expand: z.string().optional(),
  start: z.string().optional(),
  limit: z.string().optional(),
})

export const jsmTransitionBodySchema = jsmBaseBodySchema.extend({
  issueIdOrKey: jsmIssueIdOrKeyField,
  transitionId: z
    .string({ error: 'Transition ID is required' })
    .min(1, 'Transition ID is required'),
  comment: z.string().optional(),
})

export const jsmIssuePaginationBodySchema = jsmBaseBodySchema.extend({
  issueIdOrKey: jsmIssueIdOrKeyField,
  start: z.string().optional(),
  limit: z.string().optional(),
})

export const jsmApprovalsBodySchema = jsmBaseBodySchema.extend({
  action: z.string({ error: 'Action is required' }).min(1, 'Action is required'),
  issueIdOrKey: jsmIssueIdOrKeyField,
  approvalId: z.string().optional(),
  decision: z.string().optional(),
  start: z.string().optional(),
  limit: z.string().optional(),
})

export const jsmParticipantsBodySchema = jsmBaseBodySchema.extend({
  action: z.string({ error: 'Action is required' }).min(1, 'Action is required'),
  issueIdOrKey: jsmIssueIdOrKeyField,
  accountIds: z.union([z.string(), z.array(z.string())]).optional(),
  start: z.string().optional(),
  limit: z.string().optional(),
})

export const jsmCustomersBodySchema = jsmBaseBodySchema.extend({
  serviceDeskId: jsmServiceDeskIdField,
  query: z.string().optional(),
  start: z.string().optional(),
  limit: z.string().optional(),
  accountIds: jsmIdListSchema,
  emails: jsmIdListSchema,
})

export const jsmOrganizationBodySchema = jsmBaseBodySchema.extend({
  action: z.string({ error: 'Action is required' }).min(1, 'Action is required'),
  name: z.string().optional(),
  serviceDeskId: z.string().optional(),
  organizationId: z.string().optional(),
})

export const jsmIssueFormsBodySchema = jsmBaseBodySchema.extend({
  issueIdOrKey: jsmIssueIdOrKeyField,
})

export const jsmIssueFormBodySchema = jsmIssueFormsBodySchema.extend({
  formId: jsmFormIdField,
})

export const jsmAttachFormBodySchema = jsmIssueFormsBodySchema.extend({
  formTemplateId: z
    .string({ error: 'Form template ID is required' })
    .min(1, 'Form template ID is required'),
})

export const jsmSaveFormAnswersBodySchema = jsmIssueFormBodySchema.extend({
  answers: z.custom<Record<string, unknown>>(
    (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
    { message: 'Answers object is required' }
  ),
})

export const jsmProjectFormTemplatesBodySchema = jsmBaseBodySchema.extend({
  projectIdOrKey: z
    .string({ error: 'Project ID or key is required' })
    .min(1, 'Project ID or key is required'),
})

export const jsmProjectFormStructureBodySchema = jsmProjectFormTemplatesBodySchema.extend({
  formId: jsmFormIdField,
})

export const jsmCopyFormsBodySchema = jsmBaseBodySchema.extend({
  sourceIssueIdOrKey: z
    .string({ error: 'Source issue ID or key is required' })
    .min(1, 'Source issue ID or key is required'),
  targetIssueIdOrKey: z
    .string({ error: 'Target issue ID or key is required' })
    .min(1, 'Target issue ID or key is required'),
  formIds: z.array(z.string(), { error: 'formIds must be an array of form UUIDs' }).optional(),
})

export const defineJsmToolContract = <TBody extends z.ZodType>(path: string, body: TBody) =>
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

export type JsmServiceDesksBody = ContractBody<typeof jsmServiceDesksContract>
export type JsmQueuesBody = ContractBody<typeof jsmQueuesContract>
export type JsmRequestTypesBody = ContractBody<typeof jsmRequestTypesContract>
export type JsmRequestTypeFieldsBody = ContractBody<typeof jsmRequestTypeFieldsContract>
export type JsmRequestsBody = ContractBody<typeof jsmRequestsContract>
export type JsmRequestBody = ContractBody<typeof jsmRequestContract>
export type JsmCommentBody = ContractBody<typeof jsmCommentContract>
export type JsmCommentsBody = ContractBody<typeof jsmCommentsContract>
export type JsmTransitionBody = ContractBody<typeof jsmTransitionContract>
export type JsmSlaBody = ContractBody<typeof jsmSlaContract>
export type JsmTransitionsBody = ContractBody<typeof jsmTransitionsContract>
export type JsmApprovalsBody = ContractBody<typeof jsmApprovalsContract>
export type JsmParticipantsBody = ContractBody<typeof jsmParticipantsContract>
export type JsmCustomersBody = ContractBody<typeof jsmCustomersContract>
export type JsmOrganizationsBody = ContractBody<typeof jsmOrganizationsContract>
export type JsmOrganizationBody = ContractBody<typeof jsmOrganizationContract>
export type JsmIssueFormsBody = ContractBody<typeof jsmIssueFormsContract>
export type JsmAttachFormBody = ContractBody<typeof jsmAttachFormContract>
export type JsmGetFormBody = ContractBody<typeof jsmGetFormContract>
export type JsmSubmitFormBody = ContractBody<typeof jsmSubmitFormContract>
export type JsmDeleteFormBody = ContractBody<typeof jsmDeleteFormContract>
export type JsmExternaliseFormBody = ContractBody<typeof jsmExternaliseFormContract>
export type JsmInternaliseFormBody = ContractBody<typeof jsmInternaliseFormContract>
export type JsmReopenFormBody = ContractBody<typeof jsmReopenFormContract>
export type JsmSaveFormAnswersBody = ContractBody<typeof jsmSaveFormAnswersContract>
export type JsmFormAnswersBody = ContractBody<typeof jsmFormAnswersContract>
export type JsmProjectFormTemplatesBody = ContractBody<typeof jsmProjectFormTemplatesContract>
export type JsmProjectFormStructureBody = ContractBody<typeof jsmProjectFormStructureContract>
export type JsmCopyFormsBody = ContractBody<typeof jsmCopyFormsContract>
export type JsmServiceDesksSelectorResponse = ContractJsonResponse<
  typeof jsmServiceDesksSelectorContract
>
export type JsmRequestTypesSelectorResponse = ContractJsonResponse<
  typeof jsmRequestTypesSelectorContract
>
