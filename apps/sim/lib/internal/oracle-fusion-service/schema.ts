import { z } from 'zod'
import { normalizeOracleFusionDecimalIdentifier } from '@/lib/internal/oracle-fusion/identifiers'
import { encodeOracleFusionPathSegment } from '@/lib/internal/oracle-fusion/protocol'

export const oracleFusionServiceIdSchema = z.string().regex(/^[1-9][0-9]{0,17}$/)
export const oracleFusionServiceNumberSchema = z
  .string()
  .min(1)
  .max(30)
  .superRefine((value, ctx) => {
    try {
      encodeOracleFusionPathSegment(value)
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Oracle resource number' })
    }
  })
const codeSchema = z.string().trim().min(1).max(30)
const authShape = {
  accessToken: z.string().min(1).max(4096),
  instanceUrl: z.string().min(1).max(2048),
}
export const oracleFusionServiceAuthSchema = z.object(authShape).strict()
export type OracleFusionServiceAuth = z.infer<typeof oracleFusionServiceAuthSchema>

export const oracleFusionServiceInputFields = {
  srNumber: oracleFusionServiceNumberSchema,
  partyNumber: oracleFusionServiceNumberSchema,
  queueId: oracleFusionServiceIdSchema,
  businessUnitId: oracleFusionServiceIdSchema,
  memberId: oracleFusionServiceIdSchema,
  messageId: oracleFusionServiceIdSchema,
  referenceId: oracleFusionServiceIdSchema,
  accountPartyId: oracleFusionServiceIdSchema,
  contactPartyId: oracleFusionServiceIdSchema,
  resourcePartyId: oracleFusionServiceIdSchema,
  title: z.string().trim().min(1).max(400),
  problemDescription: z.string().max(1000),
  statusCode: codeSchema,
  severityCode: codeSchema,
  channelTypeCode: codeSchema,
  resolveDescription: z.string().max(1000),
  resolveOutcomeCode: codeSchema,
  resolutionCode: codeSchema,
  accessLevelCode: codeSchema,
  relationTypeCode: codeSchema,
  primaryContact: z.boolean(),
  owner: z.boolean(),
  overrideQueue: z.boolean(),
  ifMatch: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[^\u0000-\u001f\u007f]+$/),
  q: z.string().trim().min(1).max(4000),
  orderBy: z.string().trim().min(1).max(1000),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  totalResults: z.boolean().default(false),
}

export const oracleFusionServiceOperationDefinitions = {
  oracle_fusion_service_list_service_requests: {
    resource: 'request',
    kind: 'list',
    required: [],
    optional: ['q', 'orderBy', 'limit', 'offset', 'totalResults'],
  },
  oracle_fusion_service_get_service_request: {
    resource: 'request',
    kind: 'get',
    required: ['srNumber'],
    optional: [],
  },
  oracle_fusion_service_list_accounts: {
    resource: 'accounts',
    kind: 'list',
    required: [],
    optional: ['q', 'orderBy', 'limit', 'offset', 'totalResults'],
  },
  oracle_fusion_service_get_account: {
    resource: 'accounts',
    kind: 'get',
    required: ['partyNumber'],
    optional: [],
  },
  oracle_fusion_service_list_contacts: {
    resource: 'contacts',
    kind: 'list',
    required: [],
    optional: ['q', 'orderBy', 'limit', 'offset', 'totalResults'],
  },
  oracle_fusion_service_get_contact: {
    resource: 'contacts',
    kind: 'get',
    required: ['partyNumber'],
    optional: [],
  },
  oracle_fusion_service_list_queues: {
    resource: 'queues',
    kind: 'list',
    required: [],
    optional: ['q', 'orderBy', 'limit', 'offset', 'totalResults'],
  },
  oracle_fusion_service_get_queue: {
    resource: 'queues',
    kind: 'get',
    required: ['queueId'],
    optional: [],
  },
  oracle_fusion_service_list_resources: {
    resource: 'resources',
    kind: 'list',
    required: [],
    optional: ['q', 'orderBy', 'limit', 'offset', 'totalResults'],
  },
  oracle_fusion_service_get_resource: {
    resource: 'resources',
    kind: 'get',
    required: ['partyNumber'],
    optional: [],
  },
  oracle_fusion_service_list_service_business_units: {
    resource: 'businessUnits',
    kind: 'list',
    required: [],
    optional: ['q', 'orderBy', 'limit', 'offset', 'totalResults'],
  },
  oracle_fusion_service_get_service_business_unit: {
    resource: 'businessUnits',
    kind: 'get',
    required: ['businessUnitId'],
    optional: [],
  },
  oracle_fusion_service_list_service_request_statuses: {
    resource: 'statuses',
    kind: 'list',
    required: [],
    optional: ['limit', 'offset', 'totalResults'],
  },
  oracle_fusion_service_list_service_request_contacts: {
    resource: 'requestContacts',
    kind: 'list',
    required: ['srNumber'],
    optional: ['q', 'orderBy', 'limit', 'offset', 'totalResults'],
  },
  oracle_fusion_service_get_service_request_contact: {
    resource: 'requestContacts',
    kind: 'get',
    required: ['srNumber', 'memberId'],
    optional: [],
  },
  oracle_fusion_service_list_service_request_resources: {
    resource: 'requestResources',
    kind: 'list',
    required: ['srNumber'],
    optional: ['q', 'orderBy', 'limit', 'offset', 'totalResults'],
  },
  oracle_fusion_service_get_service_request_resource: {
    resource: 'requestResources',
    kind: 'get',
    required: ['srNumber', 'memberId'],
    optional: [],
  },
  oracle_fusion_service_list_service_request_messages: {
    resource: 'messages',
    kind: 'list',
    required: ['srNumber'],
    optional: ['q', 'orderBy', 'limit', 'offset', 'totalResults'],
  },
  oracle_fusion_service_get_service_request_message: {
    resource: 'messages',
    kind: 'get',
    required: ['srNumber', 'messageId'],
    optional: [],
  },
  oracle_fusion_service_list_service_request_interactions: {
    resource: 'interactions',
    kind: 'list',
    required: ['srNumber'],
    optional: ['q', 'orderBy', 'limit', 'offset', 'totalResults'],
  },
  oracle_fusion_service_get_service_request_interaction: {
    resource: 'interactions',
    kind: 'get',
    required: ['srNumber', 'referenceId'],
    optional: [],
  },
  oracle_fusion_service_create_service_request: {
    resource: 'request',
    kind: 'create',
    required: ['title', 'businessUnitId'],
    optional: [
      'problemDescription',
      'accountPartyId',
      'contactPartyId',
      'severityCode',
      'channelTypeCode',
      'statusCode',
      'queueId',
      'resourcePartyId',
    ],
  },
  oracle_fusion_service_update_service_request: {
    resource: 'request',
    kind: 'update',
    required: ['srNumber'],
    optional: [
      'title',
      'problemDescription',
      'accountPartyId',
      'contactPartyId',
      'severityCode',
      'channelTypeCode',
      'ifMatch',
    ],
  },
  oracle_fusion_service_transition_service_request_status: {
    resource: 'request',
    kind: 'update',
    required: ['srNumber', 'statusCode'],
    optional: ['resolveDescription', 'resolveOutcomeCode', 'resolutionCode', 'ifMatch'],
  },
  oracle_fusion_service_assign_service_request: {
    resource: 'request',
    kind: 'update',
    required: ['srNumber'],
    optional: ['queueId', 'resourcePartyId', 'ifMatch'],
  },
  oracle_fusion_service_run_queue_assignment: {
    resource: 'request',
    kind: 'action',
    required: ['srNumber'],
    optional: ['overrideQueue'],
  },
  oracle_fusion_service_add_service_request_contact: {
    resource: 'requestContacts',
    kind: 'create',
    required: ['srNumber', 'contactPartyId'],
    optional: ['accessLevelCode', 'relationTypeCode', 'primaryContact'],
  },
  oracle_fusion_service_remove_service_request_contact: {
    resource: 'requestContacts',
    kind: 'delete',
    required: ['srNumber', 'memberId'],
    optional: ['ifMatch'],
  },
  oracle_fusion_service_add_service_request_resource: {
    resource: 'requestResources',
    kind: 'create',
    required: ['srNumber', 'resourcePartyId'],
    optional: ['owner'],
  },
  oracle_fusion_service_remove_service_request_resource: {
    resource: 'requestResources',
    kind: 'delete',
    required: ['srNumber', 'memberId'],
    optional: ['ifMatch'],
  },
} as const

export type OracleFusionServiceToolId = keyof typeof oracleFusionServiceOperationDefinitions
export type OracleFusionServiceInput = OracleFusionServiceAuth & {
  srNumber?: string
  partyNumber?: string
  queueId?: string
  businessUnitId?: string
  memberId?: string
  messageId?: string
  referenceId?: string
  accountPartyId?: string
  contactPartyId?: string
  resourcePartyId?: string
  title?: string
  problemDescription?: string
  statusCode?: string
  severityCode?: string
  channelTypeCode?: string
  resolveDescription?: string
  resolveOutcomeCode?: string
  resolutionCode?: string
  accessLevelCode?: string
  relationTypeCode?: string
  primaryContact?: boolean
  owner?: boolean
  overrideQueue?: boolean
  ifMatch?: string
  q?: string
  orderBy?: string
  limit?: number
  offset?: number
  totalResults?: boolean
}

export function isOracleFusionServiceToolId(id: string): id is OracleFusionServiceToolId {
  return Object.hasOwn(oracleFusionServiceOperationDefinitions, id)
}

export function parseOracleFusionServiceInput(
  toolId: OracleFusionServiceToolId,
  input: unknown
): OracleFusionServiceInput {
  const definition = oracleFusionServiceOperationDefinitions[toolId]
  const shape: Record<string, z.ZodType> = { ...authShape }
  for (const key of definition.required) shape[key] = oracleFusionServiceInputFields[key]
  for (const key of definition.optional) shape[key] = oracleFusionServiceInputFields[key].optional()
  const parsed = z.object(shape).strict().parse(input) as OracleFusionServiceInput
  const patchKeys = definition.optional.filter((key) => key !== 'ifMatch')
  const updateKeys = [...definition.required.filter((key) => key !== 'srNumber'), ...patchKeys]
  if (definition.kind === 'update' && !updateKeys.some((key) => parsed[key] !== undefined)) {
    throw new z.ZodError([
      { code: z.ZodIssueCode.custom, path: [], message: 'At least one update field is required' },
    ])
  }
  return parsed
}

const responseIdSchema = z.unknown().transform((value, ctx) => {
  const id = normalizeOracleFusionDecimalIdentifier(value, { maxDigits: 18 })
  if (id === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Oracle decimal identifier' })
    return z.NEVER
  }
  return id
})

/** Project only fields documented by Oracle. Framework-v9 identifier strings remain exact. */
export const oracleFusionServiceResourceSchemas = {
  request: z.object({
    SrId: responseIdSchema.nullable().optional(),
    SrNumber: z.string().min(1),
    Title: z.string().nullable().optional(),
    ProblemDescription: z.string().nullable().optional(),
    StatusCd: z.string().nullable().optional(),
    StatusCdMeaning: z.string().nullable().optional(),
    StatusTypeCd: z.string().nullable().optional(),
    SeverityCd: z.string().nullable().optional(),
    SeverityCdMeaning: z.string().nullable().optional(),
    AccountPartyId: responseIdSchema.nullable().optional(),
    AccountPartyName: z.string().nullable().optional(),
    PrimaryContactPartyId: responseIdSchema.nullable().optional(),
    PrimaryContactPartyName: z.string().nullable().optional(),
    AssigneeResourceId: responseIdSchema.nullable().optional(),
    AssigneePartyId: responseIdSchema.nullable().optional(),
    AssigneePersonName: z.string().nullable().optional(),
    QueueId: responseIdSchema.nullable().optional(),
    QueueName: z.string().nullable().optional(),
    BUOrgId: responseIdSchema.nullable().optional(),
    BusinessUnitName: z.string().nullable().optional(),
    CategoryId: responseIdSchema.nullable().optional(),
    CategoryName: z.string().nullable().optional(),
    ChannelTypeCd: z.string().nullable().optional(),
    ResolveDescription: z.string().nullable().optional(),
    ResolveOutcomeCd: z.string().nullable().optional(),
    ResolutionCd: z.string().nullable().optional(),
    OpenDate: z.string().nullable().optional(),
    LastResolvedDate: z.string().nullable().optional(),
    ClosedDate: z.string().nullable().optional(),
    CreationDate: z.string().nullable().optional(),
    LastUpdateDate: z.string().nullable().optional(),
  }),
  accounts: z.object({
    PartyId: responseIdSchema.nullable().optional(),
    PartyNumber: z.string().min(1),
    OrganizationName: z.string().nullable().optional(),
    PartyUniqueName: z.string().nullable().optional(),
    PartyStatus: z.string().nullable().optional(),
    Type: z.string().nullable().optional(),
    EmailAddress: z.string().nullable().optional(),
    FormattedPhoneNumber: z.string().nullable().optional(),
    PrimaryContactPartyId: responseIdSchema.nullable().optional(),
    PrimaryContactName: z.string().nullable().optional(),
  }),
  contacts: z.object({
    PartyId: responseIdSchema.nullable().optional(),
    PartyNumber: z.string().min(1),
    ContactName: z.string().nullable().optional(),
    ContactUniqueName: z.string().nullable().optional(),
    FirstName: z.string().nullable().optional(),
    LastName: z.string().nullable().optional(),
    EmailAddress: z.string().nullable().optional(),
    OverallPrimaryFormattedPhoneNumber: z.string().nullable().optional(),
    AccountPartyId: responseIdSchema.nullable().optional(),
    AccountName: z.string().nullable().optional(),
    PartyStatus: z.string().nullable().optional(),
  }),
  queues: z.object({
    QueueId: responseIdSchema,
    QueueNumber: z.string().nullable().optional(),
    QueueName: z.string().nullable().optional(),
    QueueDescription: z.string().nullable().optional(),
    EnabledFlag: z.boolean().nullable().optional(),
    AutoRoutingFlag: z.boolean().nullable().optional(),
    StripeCd: z.string().nullable().optional(),
    OwnerResourceId: responseIdSchema.nullable().optional(),
    ResourceCount: z.number().int().nonnegative().safe().nullable().optional(),
    OpenSrCount: z.number().int().nonnegative().safe().nullable().optional(),
  }),
  resources: z.object({
    PartyId: responseIdSchema.nullable().optional(),
    PartyNumber: z.string().min(1),
    PartyName: z.string().nullable().optional(),
    Username: z.string().nullable().optional(),
    EmailAddress: z.string().nullable().optional(),
    FormattedPhoneNumber: z.string().nullable().optional(),
    ResourceProfileId: responseIdSchema.nullable().optional(),
    ResourceType: z.string().nullable().optional(),
    StartDateActive: z.string().nullable().optional(),
    EndDateActive: z.string().nullable().optional(),
  }),
  businessUnits: z.object({
    BUOrgId: responseIdSchema,
    BusinessUnitName: z.string().nullable().optional(),
    BusinessUnitId: responseIdSchema.nullable().optional(),
    Name: z.string().nullable().optional(),
  }),
  statuses: z.object({
    LookupCode: z.string().min(1),
    Meaning: z.string().nullable().optional(),
    Description: z.string().nullable().optional(),
    ParentLookupCode: z.string().nullable().optional(),
    EnabledFlag: z.boolean().nullable().optional(),
    StartDateActive: z.string().nullable().optional(),
    EndDateActive: z.string().nullable().optional(),
  }),
  requestContacts: z.object({
    MemberId: responseIdSchema,
    SrId: responseIdSchema.nullable().optional(),
    SrNumber: z.string().nullable().optional(),
    PartyId: responseIdSchema.nullable().optional(),
    ContactPartyNumber: z.string().nullable().optional(),
    ContactUniqueName: z.string().nullable().optional(),
    ContactEmailAddress: z.string().nullable().optional(),
    ContactFormattedPhoneNumber: z.string().nullable().optional(),
    PrimaryContactFlag: z.boolean().nullable().optional(),
    RelationTypeCd: z.string().nullable().optional(),
    AccessLevelCd: z.string().nullable().optional(),
  }),
  requestResources: z.object({
    MemberId: responseIdSchema,
    SrId: responseIdSchema.nullable().optional(),
    SrNumber: z.string().nullable().optional(),
    ObjectId: responseIdSchema.nullable().optional(),
    ObjectTypeCd: z.string().nullable().optional(),
    ResourceName: z.string().nullable().optional(),
    ResourcePartyNumber: z.string().nullable().optional(),
    ResourceEmailAddress: z.string().nullable().optional(),
    OwnerFlag: z.boolean().nullable().optional(),
    Username: z.string().nullable().optional(),
  }),
  messages: z.object({
    MessageId: responseIdSchema,
    SrId: responseIdSchema.nullable().optional(),
    SrNumber: z.string().nullable().optional(),
    MessageNumber: z.string().nullable().optional(),
    MessageTypeCd: z.string().nullable().optional(),
    MessageSubTypeCd: z.string().nullable().optional(),
    Subject: z.string().nullable().optional(),
    StatusCd: z.string().nullable().optional(),
    VisibilityCd: z.string().nullable().optional(),
    PartyName: z.string().nullable().optional(),
    PostedByPartyId: responseIdSchema.nullable().optional(),
    ParentMessageId: responseIdSchema.nullable().optional(),
    ChannelTypeCd: z.string().nullable().optional(),
    CreationDate: z.string().nullable().optional(),
    LastUpdateDate: z.string().nullable().optional(),
    SentDate: z.string().nullable().optional(),
    MessageContent: z.string().nullable().optional(),
  }),
  interactions: z.object({
    ReferenceId: responseIdSchema,
    InteractionId: responseIdSchema.nullable().optional(),
    Description: z.string().nullable().optional(),
    ChannelTypeCd: z.string().nullable().optional(),
    DirectionCd: z.string().nullable().optional(),
    StatusCd: z.string().nullable().optional(),
    StartTime: z.string().nullable().optional(),
    EndTime: z.string().nullable().optional(),
    ContactPartyId: responseIdSchema.nullable().optional(),
    ContactPartyUniqueName: z.string().nullable().optional(),
    AccountPartyId: responseIdSchema.nullable().optional(),
    AccountPartyUniqueName: z.string().nullable().optional(),
    OwnerResourceId: responseIdSchema.nullable().optional(),
    OwnerResourcePartyUniqueName: z.string().nullable().optional(),
    QueueId: responseIdSchema.nullable().optional(),
    QueueName: z.string().nullable().optional(),
    CreationDate: z.string().nullable().optional(),
  }),
}
export type OracleFusionServiceResource = keyof typeof oracleFusionServiceResourceSchemas
