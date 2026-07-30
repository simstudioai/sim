import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

/** Credential + version fields shared by every SailPoint operation. */
const sailpointBaseFields = {
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
  tenant: z.string().min(1, 'Tenant is required'),
  apiVersion: z.enum(['v2025', 'v2024', 'v3']).optional(),
}

const filtersField = z.string().optional()
const sortersField = z.string().optional()
const offsetField = z.coerce.number().int().min(0, 'Offset must be 0 or greater').optional()
const countField = z.boolean().optional()

const limitField = (max: number) =>
  z.coerce
    .number()
    .int()
    .min(0, 'Limit must be 0 or greater')
    .max(max, `Limit must be at most ${max}`)
    .optional()

/** Standard limit/offset/count trio with a per-endpoint limit cap. */
const pagination = (limitMax: number) => ({
  limit: limitField(limitMax),
  offset: offsetField,
  count: countField,
})

const idField = (label: string) => z.string().min(1, `${label} is required`)

/** Accepts an array of strings or a single string (route normalizes). */
const stringListField = z.union([z.array(z.string()), z.string()]).optional()

/** Parses a JSON string into a value before applying the inner schema. */
function parseJson(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  return value
}

const requestedForSchema = z.preprocess(parseJson, z.array(z.string()))

const requestedItemSchema = z.object({
  type: z.enum(['ACCESS_PROFILE', 'ROLE', 'ENTITLEMENT']),
  id: z.string().min(1, 'requestedItems[].id is required'),
  comment: z.string().optional(),
  removeDate: z.string().optional(),
  startDate: z.string().optional(),
  assignmentId: z.string().optional(),
  nativeIdentity: z.string().optional(),
  clientMetadata: z.record(z.string(), z.string()).optional(),
})

const requestedItemsSchema = z.preprocess(parseJson, z.array(requestedItemSchema))
const clientMetadataSchema = z.preprocess(parseJson, z.record(z.string(), z.string())).optional()

const LIMIT_STANDARD = 250
const LIMIT_SEARCH = 10000
const LIMIT_ROLES = 50

const searchSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_search'),
  indices: stringListField,
  query: z.string().optional(),
  sort: stringListField,
  searchAfter: stringListField,
  includeNested: z.boolean().optional(),
  ...pagination(LIMIT_SEARCH),
})

const searchCountSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_search_count'),
  indices: stringListField,
  query: z.string().optional(),
})

const searchAggregateSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_search_aggregate'),
  indices: stringListField,
  query: z.string().optional(),
  limit: limitField(LIMIT_STANDARD),
  offset: offsetField,
})

const listIdentitiesSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_list_identities'),
  filters: filtersField,
  sorters: sortersField,
  defaultFilter: z.enum(['CORRELATED_ONLY', 'NONE']).optional(),
  ...pagination(LIMIT_STANDARD),
})

const getIdentitySchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_get_identity'),
  id: idField('Identity ID'),
})

const listAccountsSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_list_accounts'),
  filters: filtersField,
  sorters: sortersField,
  detailLevel: z.enum(['SLIM', 'FULL']).optional(),
  ...pagination(LIMIT_STANDARD),
})

const getAccountSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_get_account'),
  id: idField('Account ID'),
})

const getAccountEntitlementsSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_get_account_entitlements'),
  id: idField('Account ID'),
  ...pagination(LIMIT_STANDARD),
})

const listEntitlementsSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_list_entitlements'),
  filters: filtersField,
  sorters: sortersField,
  accountId: z.string().optional(),
  segmentedForIdentity: z.string().optional(),
  ...pagination(LIMIT_STANDARD),
})

const getEntitlementSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_get_entitlement'),
  id: idField('Entitlement ID'),
})

const listRolesSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_list_roles'),
  filters: filtersField,
  sorters: sortersField,
  ...pagination(LIMIT_ROLES),
})

const getRoleEntitlementsSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_get_role_entitlements'),
  id: idField('Role ID'),
  filters: filtersField,
  sorters: sortersField,
  ...pagination(LIMIT_ROLES),
})

const listAccessProfilesSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_list_access_profiles'),
  filters: filtersField,
  sorters: sortersField,
  ...pagination(LIMIT_STANDARD),
})

const getAccessProfileEntitlementsSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_get_access_profile_entitlements'),
  id: idField('Access Profile ID'),
  filters: filtersField,
  sorters: sortersField,
  ...pagination(LIMIT_STANDARD),
})

const listSourcesSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_list_sources'),
  filters: filtersField,
  sorters: sortersField,
  forSubadmin: z.string().optional(),
  includeIDNSource: z.boolean().optional(),
  ...pagination(LIMIT_STANDARD),
})

const getSourceSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_get_source'),
  id: idField('Source ID'),
})

const listAccountActivitiesSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_list_account_activities'),
  requestedFor: z.string().optional(),
  requestedBy: z.string().optional(),
  regardingIdentity: z.string().optional(),
  filters: filtersField,
  sorters: sortersField,
  ...pagination(LIMIT_STANDARD),
})

const getAccountActivitySchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_get_account_activity'),
  id: idField('Account activity ID'),
})

const listCampaignsSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_list_campaigns'),
  detail: z.enum(['SLIM', 'FULL']).optional(),
  filters: filtersField,
  sorters: sortersField,
  ...pagination(LIMIT_STANDARD),
})

const getCampaignSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_get_campaign'),
  id: idField('Campaign ID'),
  detail: z.enum(['SLIM', 'FULL']).optional(),
})

const listCertificationsSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_list_certifications'),
  reviewerIdentity: z.string().optional(),
  filters: filtersField,
  sorters: sortersField,
  ...pagination(LIMIT_STANDARD),
})

const listCertificationReviewItemsSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_list_certification_review_items'),
  id: idField('Certification ID'),
  filters: filtersField,
  sorters: sortersField,
  entitlements: z.string().optional(),
  accessProfiles: z.string().optional(),
  roles: z.string().optional(),
  ...pagination(LIMIT_STANDARD),
})

const requestAccessSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_request_access'),
  requestedFor: requestedForSchema,
  requestedItems: requestedItemsSchema,
  requestType: z.enum(['GRANT_ACCESS', 'REVOKE_ACCESS', 'MODIFY_ACCESS']).optional(),
  clientMetadata: clientMetadataSchema,
})

const cancelAccessRequestSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_cancel_access_request'),
  accountActivityId: idField('accountActivityId'),
  comment: z.string().min(1, 'comment is required to cancel an access request'),
})

const getAccessRequestStatusSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_get_access_request_status'),
  requestedFor: z.string().optional(),
  requestedBy: z.string().optional(),
  regardingIdentity: z.string().optional(),
  assignedTo: z.string().optional(),
  requestState: z.enum(['EXECUTING']).optional(),
  filters: filtersField,
  sorters: sortersField,
  ...pagination(LIMIT_STANDARD),
})

/**
 * Discriminated union of every JSON operation handled by `/api/tools/sailpoint/query`. The
 * `.superRefine` enforces SailPoint's documented access-request constraints (server-side 400s)
 * before submission so callers get descriptive, field-anchored errors.
 */
export const sailpointQueryBodySchema = z
  .discriminatedUnion('operation', [
    searchSchema,
    searchCountSchema,
    searchAggregateSchema,
    listIdentitiesSchema,
    getIdentitySchema,
    listAccountsSchema,
    getAccountSchema,
    getAccountEntitlementsSchema,
    listEntitlementsSchema,
    getEntitlementSchema,
    listRolesSchema,
    getRoleEntitlementsSchema,
    listAccessProfilesSchema,
    getAccessProfileEntitlementsSchema,
    listSourcesSchema,
    getSourceSchema,
    listAccountActivitiesSchema,
    getAccountActivitySchema,
    listCampaignsSchema,
    getCampaignSchema,
    listCertificationsSchema,
    listCertificationReviewItemsSchema,
    requestAccessSchema,
    cancelAccessRequestSchema,
    getAccessRequestStatusSchema,
  ])
  .superRefine((val, ctx) => {
    if (val.operation !== 'sailpoint_request_access') return

    const requestType = val.requestType ?? 'GRANT_ACCESS'
    const requestedFor = val.requestedFor
    const requestedItems = val.requestedItems

    if (requestedFor.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requestedFor'],
        message: 'requestedFor must contain at least one identity ID',
      })
    }
    if (requestedItems.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requestedItems'],
        message: 'requestedItems must contain at least one item',
      })
    }

    if (requestType === 'REVOKE_ACCESS') {
      if (requestedFor.length > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['requestedFor'],
          message: 'REVOKE_ACCESS supports exactly one identity per request',
        })
      }
      if (requestedItems.length > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['requestedItems'],
          message:
            'REVOKE_ACCESS supports exactly one item per request (there is no bulk-revoke endpoint)',
        })
      }
      requestedItems.forEach((item, index) => {
        if (!item.comment) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['requestedItems', index, 'comment'],
            message: 'comment is required for REVOKE_ACCESS requests',
          })
        }
        if (item.startDate) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['requestedItems', index, 'startDate'],
            message: 'startDate is not allowed on REVOKE_ACCESS requests',
          })
        }
      })
    }

    if (requestType === 'GRANT_ACCESS') {
      const hasEntitlement = requestedItems.some((item) => item.type === 'ENTITLEMENT')
      if (hasEntitlement) {
        if (requestedItems.length > 25) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['requestedItems'],
            message: 'A grant that includes entitlements may request at most 25 items',
          })
        }
        if (requestedFor.length > 10) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['requestedFor'],
            message: 'A grant that includes entitlements may request for at most 10 identities',
          })
        }
      }
    }
  })

const loadAccountsSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_load_accounts'),
  sourceId: idField('Source ID'),
  file: FileInputSchema.optional().nullable(),
  disableOptimization: z.boolean().optional(),
})

const loadEntitlementsSchema = z.object({
  ...sailpointBaseFields,
  operation: z.literal('sailpoint_load_entitlements'),
  sourceId: idField('Source ID'),
  file: FileInputSchema.optional().nullable(),
})

export const sailpointLoadBodySchema = z.discriminatedUnion('operation', [
  loadAccountsSchema,
  loadEntitlementsSchema,
])

const listOutputSchema = z.object({
  items: z.array(z.unknown()),
  count: z.number(),
  totalCount: z.number().nullable(),
  complete: z.boolean(),
  warnings: z.array(z.string()),
})

const searchOutputSchema = z.object({
  results: z.array(z.unknown()),
  count: z.number(),
  totalCount: z.number().nullable(),
  complete: z.boolean(),
  warnings: z.array(z.string()),
})

const countOutputSchema = z.object({ total: z.number() })
const itemOutputSchema = z.object({ item: z.unknown() })
const writeOutputSchema = z.object({ accepted: z.boolean(), status: z.number() })
const taskOutputSchema = z.object({ task: z.unknown() })

const okResponse = <T extends z.ZodTypeAny>(output: T) =>
  z.object({ success: z.literal(true), output })

const sailpointQueryResponseSchema = z.union([
  okResponse(listOutputSchema),
  okResponse(searchOutputSchema),
  okResponse(countOutputSchema),
  okResponse(itemOutputSchema),
  okResponse(writeOutputSchema),
])

const sailpointLoadResponseSchema = okResponse(taskOutputSchema)

export const sailpointQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sailpoint/query',
  body: sailpointQueryBodySchema,
  response: { mode: 'json', schema: sailpointQueryResponseSchema },
})

export const sailpointLoadContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sailpoint/load',
  body: sailpointLoadBodySchema,
  response: { mode: 'json', schema: sailpointLoadResponseSchema },
})

export type SailpointQueryBody = ContractBody<typeof sailpointQueryContract>
export type SailpointQueryBodyInput = ContractBodyInput<typeof sailpointQueryContract>
export type SailpointQueryResponse = ContractJsonResponse<typeof sailpointQueryContract>
export type SailpointLoadBody = ContractBody<typeof sailpointLoadContract>
export type SailpointLoadBodyInput = ContractBodyInput<typeof sailpointLoadContract>
export type SailpointLoadResponse = ContractJsonResponse<typeof sailpointLoadContract>
