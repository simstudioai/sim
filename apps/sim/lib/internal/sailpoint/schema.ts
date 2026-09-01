import { z } from 'zod'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

const MAX_ID_LENGTH = 1024
const MAX_FILTER_LENGTH = 20_000
const MAX_QUERY_LENGTH = 100_000
const MAX_METADATA_ENTRIES = 100
const STANDARD_LIMIT_MAX = 250
const SEARCH_LIMIT_MAX = 10_000
const ROLE_LIMIT_MAX = 50

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

const requiredString = (label: string, max = MAX_ID_LENGTH) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`)

const optionalString = (max = MAX_FILTER_LENGTH) => z.string().max(max).optional()

const baseFields = {
  clientId: requiredString('Client ID'),
  clientSecret: requiredString('Client Secret', 8192),
  tenant: requiredString('Tenant', 253),
}

const offsetField = z.coerce.number().int().min(0).optional()
const countField = z.boolean().optional()
const limitField = (max: number) => z.coerce.number().int().min(0).max(max).optional()
const pagination = (max = STANDARD_LIMIT_MAX) => ({
  limit: limitField(max),
  offset: offsetField,
  count: countField,
})
const listFields = (max = STANDARD_LIMIT_MAX) => ({
  filters: optionalString(),
  sorters: optionalString(),
  ...pagination(max),
})

const stringListField = z.preprocess(
  parseJson,
  z.union([z.array(z.string().max(MAX_FILTER_LENGTH)).max(100), z.string()]).optional()
)

const jsonObjectField = z.preprocess(parseJson, z.record(z.string(), z.unknown())).optional()
const searchQuerySchema = z.object({
  query: z.string().max(MAX_QUERY_LENGTH).optional(),
  fields: z.string().max(MAX_FILTER_LENGTH).optional(),
  timeZone: z.string().max(255).optional(),
  innerHit: z.record(z.string(), z.unknown()).optional(),
})
const textQuerySchema = z.object({
  terms: z.array(z.string().max(MAX_QUERY_LENGTH)).min(1).max(100),
  fields: z.array(z.string().max(MAX_FILTER_LENGTH)).min(1).max(100),
  matchAny: z.boolean().optional(),
  contains: z.boolean().optional(),
})
const typeAheadQuerySchema = z.object({
  query: z.string().max(MAX_QUERY_LENGTH),
  field: z.string().max(MAX_FILTER_LENGTH),
  nestedType: z.string().max(MAX_FILTER_LENGTH).optional(),
  maxExpansions: z.coerce.number().int().min(1).max(1000).optional(),
  size: z.coerce.number().int().min(1).optional(),
  sort: z.string().max(255).optional(),
  sortByValue: z.boolean().optional(),
})
const queryResultFilterSchema = z.object({
  includes: z.array(z.string().max(MAX_FILTER_LENGTH)).max(1000).optional(),
  excludes: z.array(z.string().max(MAX_FILTER_LENGTH)).max(1000).optional(),
})
const searchFields = {
  indices: stringListField,
  queryType: z.enum(['DSL', 'SAILPOINT', 'TEXT', 'TYPEAHEAD']).optional(),
  queryVersion: z.string().max(64).optional(),
  query: z
    .preprocess(parseJson, z.union([z.string().max(MAX_QUERY_LENGTH), searchQuerySchema]))
    .optional(),
  queryDsl: jsonObjectField,
  textQuery: z.preprocess(parseJson, textQuerySchema).optional(),
  typeAheadQuery: z.preprocess(parseJson, typeAheadQuerySchema).optional(),
  includeNested: z.boolean().optional(),
  queryResultFilter: z.preprocess(parseJson, queryResultFilterSchema).optional(),
  aggregationType: z.enum(['DSL', 'SAILPOINT']).optional(),
  aggregationsVersion: z.string().max(64).optional(),
  aggregationsDsl: jsonObjectField,
  aggregations: jsonObjectField,
  sort: stringListField,
  searchAfter: stringListField,
  filters: jsonObjectField,
}

function validateSearchQuerySelection(
  value: Record<string, unknown>,
  ctx: z.RefinementCtx,
  queryRequired: boolean
): void {
  const hasQueryInput =
    value.query !== undefined ||
    value.queryDsl !== undefined ||
    value.textQuery !== undefined ||
    value.typeAheadQuery !== undefined
  if (!queryRequired && value.queryType === undefined && !hasQueryInput) return

  const queryType = value.queryType ?? 'SAILPOINT'
  const requiredField = {
    DSL: 'queryDsl',
    SAILPOINT: 'query',
    TEXT: 'textQuery',
    TYPEAHEAD: 'typeAheadQuery',
  }[queryType as 'DSL' | 'SAILPOINT' | 'TEXT' | 'TYPEAHEAD']
  if (value[requiredField] === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [requiredField],
      message: `${requiredField} is required when queryType is ${queryType}`,
    })
  }
}

const metadataSchema = z
  .record(z.string().max(1024), z.string().max(10_000))
  .refine((value) => Object.keys(value).length <= MAX_METADATA_ENTRIES, {
    message: `Metadata may contain at most ${MAX_METADATA_ENTRIES} entries`,
  })

const requestedItemSchema = z.object({
  type: z.enum(['ACCESS_PROFILE', 'ROLE', 'ENTITLEMENT']),
  id: requiredString('Requested item ID'),
  comment: optionalString(10_000),
  removeDate: z.string().datetime({ offset: true }).optional(),
  startDate: z.string().datetime({ offset: true }).optional(),
  assignmentId: optionalString(MAX_ID_LENGTH),
  nativeIdentity: optionalString(10_000),
  formInstanceId: optionalString(MAX_ID_LENGTH),
  clientMetadata: metadataSchema.optional(),
})

const sourceItemRefSchema = z.object({
  sourceId: z.string().max(MAX_ID_LENGTH).nullable().optional(),
  accounts: z
    .array(
      z.object({
        accountUuid: z.string().max(MAX_ID_LENGTH).nullable().optional(),
        nativeIdentity: z.string().max(10_000).optional(),
      })
    )
    .max(100)
    .nullable()
    .optional(),
})

const nestedRequestedItemSchema = requestedItemSchema.extend({
  accountSelection: z.array(sourceItemRefSchema).max(100).nullable().optional(),
})

const requestedForWithItemsSchema = z.object({
  identityId: requiredString('Identity ID'),
  identityType: z.enum(['HUMAN', 'MACHINE']).optional(),
  requestedItems: z.array(nestedRequestedItemSchema).min(1).max(250),
})

const reviewDecisionSchema = z.object({
  id: requiredString('Review item ID'),
  decision: z.enum(['APPROVE', 'REVOKE']),
  proposedEndDate: z.string().datetime({ offset: true }).optional(),
  bulk: z.boolean(),
  recommendation: z
    .object({
      recommendation: z.string().nullable().optional(),
      reasons: z.array(z.string().max(10_000)).max(100).optional(),
      timestamp: z.string().datetime({ offset: true }).optional(),
    })
    .nullable()
    .optional(),
  comments: optionalString(10_000),
})

function operationSchema<T extends string, S extends z.ZodRawShape>(operation: T, fields: S) {
  return z.object({ ...baseFields, operation: z.literal(operation), ...fields })
}

const schemas = {
  sailpoint_search: operationSchema('sailpoint_search', {
    ...searchFields,
    ...pagination(SEARCH_LIMIT_MAX),
  }).superRefine((value, ctx) => validateSearchQuerySelection(value, ctx, true)),
  sailpoint_search_count: operationSchema('sailpoint_search_count', {
    ...searchFields,
  }).superRefine((value, ctx) => validateSearchQuerySelection(value, ctx, true)),
  sailpoint_search_aggregate: operationSchema('sailpoint_search_aggregate', {
    ...searchFields,
    ...pagination(),
  }).superRefine((value, ctx) => {
    validateSearchQuerySelection(value, ctx, false)
    if (!value.aggregationsDsl && !value.aggregations) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['aggregationsDsl'],
        message: 'aggregationsDsl or aggregations is required',
      })
    }
  }),
  sailpoint_list_identities: operationSchema('sailpoint_list_identities', {
    ...listFields(),
    defaultFilter: z.enum(['CORRELATED_ONLY', 'NONE']).optional(),
  }),
  sailpoint_get_identity: operationSchema('sailpoint_get_identity', {
    id: requiredString('Identity ID'),
  }),
  sailpoint_list_identity_entitlements: operationSchema('sailpoint_list_identity_entitlements', {
    id: requiredString('Identity ID'),
    ...pagination(),
  }),
  sailpoint_list_accounts: operationSchema('sailpoint_list_accounts', {
    ...listFields(),
    detailLevel: z.enum(['SLIM', 'FULL']).optional(),
  }),
  sailpoint_get_account: operationSchema('sailpoint_get_account', {
    id: requiredString('Account ID'),
  }),
  sailpoint_get_account_entitlements: operationSchema('sailpoint_get_account_entitlements', {
    id: requiredString('Account ID'),
    ...pagination(),
  }),
  sailpoint_list_entitlements: operationSchema('sailpoint_list_entitlements', {
    ...listFields(),
    segmentedForIdentity: optionalString(MAX_ID_LENGTH),
    forSegmentIds: optionalString(MAX_FILTER_LENGTH),
    includeUnsegmented: z.boolean().optional(),
    searchAfter: optionalString(MAX_FILTER_LENGTH),
  }).superRefine((value, ctx) => {
    if (value.includeUnsegmented === false && !value.forSegmentIds && !value.segmentedForIdentity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['includeUnsegmented'],
        message: 'includeUnsegmented=false requires forSegmentIds or segmentedForIdentity',
      })
    }
  }),
  sailpoint_get_entitlement: operationSchema('sailpoint_get_entitlement', {
    id: requiredString('Entitlement ID'),
  }),
  sailpoint_list_roles: operationSchema('sailpoint_list_roles', {
    ...listFields(ROLE_LIMIT_MAX),
    forSubadmin: optionalString(MAX_ID_LENGTH),
    forSegmentIds: optionalString(MAX_FILTER_LENGTH),
    includeUnsegmented: z.boolean().optional(),
  }).superRefine((value, ctx) => {
    if (value.includeUnsegmented === false && !value.forSegmentIds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['includeUnsegmented'],
        message: 'includeUnsegmented=false requires forSegmentIds',
      })
    }
  }),
  sailpoint_get_role: operationSchema('sailpoint_get_role', { id: requiredString('Role ID') }),
  sailpoint_get_role_entitlements: operationSchema('sailpoint_get_role_entitlements', {
    id: requiredString('Role ID'),
    ...listFields(ROLE_LIMIT_MAX),
  }),
  sailpoint_list_access_profiles: operationSchema('sailpoint_list_access_profiles', {
    ...listFields(),
    forSubadmin: optionalString(MAX_ID_LENGTH),
    forSegmentIds: optionalString(MAX_FILTER_LENGTH),
    includeUnsegmented: z.boolean().optional(),
  }).superRefine((value, ctx) => {
    if (value.includeUnsegmented === false && !value.forSegmentIds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['includeUnsegmented'],
        message: 'includeUnsegmented=false requires forSegmentIds',
      })
    }
  }),
  sailpoint_get_access_profile: operationSchema('sailpoint_get_access_profile', {
    id: requiredString('Access Profile ID'),
  }),
  sailpoint_get_access_profile_entitlements: operationSchema(
    'sailpoint_get_access_profile_entitlements',
    { id: requiredString('Access Profile ID'), ...listFields() }
  ),
  sailpoint_list_sources: operationSchema('sailpoint_list_sources', {
    ...listFields(),
    forSubadmin: optionalString(MAX_ID_LENGTH),
    includeIDNSource: z.boolean().optional(),
  }),
  sailpoint_get_source: operationSchema('sailpoint_get_source', {
    id: requiredString('Source ID'),
  }),
  sailpoint_list_account_activities: operationSchema('sailpoint_list_account_activities', {
    ...listFields(),
    requestedFor: optionalString(MAX_ID_LENGTH),
    requestedBy: optionalString(MAX_ID_LENGTH),
    regardingIdentity: optionalString(MAX_ID_LENGTH),
  }).superRefine((value, ctx) => {
    if (value.regardingIdentity && (value.requestedFor || value.requestedBy)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['regardingIdentity'],
        message: 'regardingIdentity cannot be combined with requestedFor or requestedBy',
      })
    }
  }),
  sailpoint_get_account_activity: operationSchema('sailpoint_get_account_activity', {
    id: requiredString('Account activity ID'),
  }),
  sailpoint_list_campaigns: operationSchema('sailpoint_list_campaigns', {
    ...listFields(),
    detail: z.enum(['SLIM', 'FULL']).optional(),
  }),
  sailpoint_get_campaign: operationSchema('sailpoint_get_campaign', {
    id: requiredString('Campaign ID'),
    detail: z.enum(['SLIM', 'FULL']).optional(),
  }),
  sailpoint_list_certifications: operationSchema('sailpoint_list_certifications', {
    ...listFields(),
    reviewerIdentity: optionalString(MAX_ID_LENGTH),
  }),
  sailpoint_get_certification: operationSchema('sailpoint_get_certification', {
    id: requiredString('Certification ID'),
  }),
  sailpoint_list_certification_review_items: operationSchema(
    'sailpoint_list_certification_review_items',
    {
      id: requiredString('Certification ID'),
      ...listFields(),
      entitlements: optionalString(MAX_FILTER_LENGTH),
      accessProfiles: optionalString(MAX_FILTER_LENGTH),
      roles: optionalString(MAX_FILTER_LENGTH),
    }
  ).superRefine((value, ctx) => {
    const specialized = [value.entitlements, value.accessProfiles, value.roles].filter(Boolean)
    if (specialized.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entitlements'],
        message: 'Only one of entitlements, accessProfiles, or roles may be provided',
      })
    }
  }),
  sailpoint_decide_certification_review_items: operationSchema(
    'sailpoint_decide_certification_review_items',
    {
      id: requiredString('Certification ID'),
      decisions: z.preprocess(parseJson, z.array(reviewDecisionSchema).min(1).max(250)),
    }
  ),
  sailpoint_sign_off_certification: operationSchema('sailpoint_sign_off_certification', {
    id: requiredString('Certification ID'),
  }),
  sailpoint_request_access: operationSchema('sailpoint_request_access', {
    requestedFor: z
      .preprocess(parseJson, z.array(requiredString('Identity ID')).max(250))
      .optional(),
    requestedItems: z
      .preprocess(parseJson, z.array(requestedItemSchema).min(1).max(250))
      .optional(),
    requestedForWithRequestedItems: z
      .preprocess(parseJson, z.array(requestedForWithItemsSchema).min(1).max(10))
      .optional(),
    requestType: z.enum(['GRANT_ACCESS', 'REVOKE_ACCESS', 'MODIFY_ACCESS']).optional(),
    clientMetadata: z.preprocess(parseJson, metadataSchema).optional(),
  }).superRefine((value, ctx) => {
    const usesFlat = value.requestedFor !== undefined || value.requestedItems !== undefined
    const usesNested = value.requestedForWithRequestedItems !== undefined
    if (usesFlat === usesNested) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requestedFor'],
        message:
          'Provide requestedFor with requestedItems, or requestedForWithRequestedItems, but not both',
      })
      return
    }
    if (usesFlat && (!value.requestedFor?.length || !value.requestedItems?.length)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requestedItems'],
        message: 'requestedFor and requestedItems must both be non-empty',
      })
    }
    if ((value.requestType ?? 'GRANT_ACCESS') === 'REVOKE_ACCESS' && value.requestedFor) {
      if (value.requestedFor.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['requestedFor'],
          message: 'REVOKE_ACCESS supports exactly one identity',
        })
      }
      value.requestedItems?.forEach((item, index) => {
        if (!item.comment) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['requestedItems', index, 'comment'],
            message: 'comment is required for REVOKE_ACCESS',
          })
        }
        if (item.startDate) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['requestedItems', index, 'startDate'],
            message: 'startDate is not allowed for REVOKE_ACCESS',
          })
        }
      })
      const entitlementCount =
        value.requestedItems?.filter((item) => item.type === 'ENTITLEMENT').length ?? 0
      if (entitlementCount > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['requestedItems'],
          message: 'REVOKE_ACCESS supports at most one entitlement item',
        })
      }
    }
    if ((value.requestType ?? 'GRANT_ACCESS') === 'GRANT_ACCESS' && value.requestedItems) {
      const entitlementCount = value.requestedItems.filter(
        (item) => item.type === 'ENTITLEMENT'
      ).length
      if (entitlementCount > 25) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['requestedItems'],
          message: 'GRANT_ACCESS supports at most 25 entitlement items',
        })
      }
      if (entitlementCount > 0 && (value.requestedFor?.length ?? 0) > 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['requestedFor'],
          message: 'A grant with entitlements supports at most 10 identities',
        })
      }
    }
    if (value.requestedForWithRequestedItems) {
      const identityTypes = new Set(
        value.requestedForWithRequestedItems.map((entry) => entry.identityType ?? 'HUMAN')
      )
      if (identityTypes.size > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['requestedForWithRequestedItems'],
          message: 'Human and machine identities cannot be mixed in one request',
        })
      }
      if (identityTypes.has('MACHINE')) {
        const requestType = value.requestType ?? 'GRANT_ACCESS'
        value.requestedForWithRequestedItems.forEach((entry, entryIndex) => {
          entry.requestedItems.forEach((item, itemIndex) => {
            const path = ['requestedForWithRequestedItems', entryIndex, 'requestedItems', itemIndex]
            if (item.type !== 'ENTITLEMENT') {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [...path, 'type'],
                message: 'Machine identity requests support entitlement items only',
              })
            }
            if (requestType === 'REVOKE_ACCESS' && item.accountSelection) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [...path, 'accountSelection'],
                message: 'Machine identity revoke requests cannot include accountSelection',
              })
            }
            if (requestType !== 'REVOKE_ACCESS') {
              const selection = item.accountSelection
              if (
                !selection ||
                selection.length !== 1 ||
                !selection[0]?.accounts ||
                selection[0].accounts.length !== 1
              ) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: [...path, 'accountSelection'],
                  message:
                    'Machine identity grant and modify items require exactly one source and one account selection',
                })
              }
            }
            if (requestType === 'MODIFY_ACCESS' && !item.startDate && !item.removeDate) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path,
                message: 'Machine identity modify items require startDate or removeDate',
              })
            }
          })
        })
      } else if ((value.requestType ?? 'GRANT_ACCESS') === 'REVOKE_ACCESS') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['requestedForWithRequestedItems'],
          message: 'Human revoke requests must use requestedFor and requestedItems',
        })
      }
    }
  }),
  sailpoint_cancel_access_request: operationSchema('sailpoint_cancel_access_request', {
    accountActivityId: requiredString('Account activity ID'),
    comment: requiredString('Comment', 10_000),
  }),
  sailpoint_get_access_request_status: operationSchema('sailpoint_get_access_request_status', {
    ...listFields(),
    requestedFor: optionalString(MAX_ID_LENGTH),
    requestedBy: optionalString(MAX_ID_LENGTH),
    regardingIdentity: optionalString(MAX_ID_LENGTH),
    assignedTo: optionalString(MAX_ID_LENGTH),
    requestState: z.literal('EXECUTING').optional(),
  }).superRefine((value, ctx) => {
    if (value.regardingIdentity && (value.requestedFor || value.requestedBy)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['regardingIdentity'],
        message: 'regardingIdentity cannot be combined with requestedFor or requestedBy',
      })
    }
  }),
  sailpoint_list_pending_access_request_approvals: operationSchema(
    'sailpoint_list_pending_access_request_approvals',
    { ownerId: optionalString(MAX_ID_LENGTH), ...listFields() }
  ),
  sailpoint_approve_access_request: operationSchema('sailpoint_approve_access_request', {
    approvalId: requiredString('Approval ID'),
    comment: optionalString(10_000),
  }),
  sailpoint_reject_access_request: operationSchema('sailpoint_reject_access_request', {
    approvalId: requiredString('Approval ID'),
    comment: requiredString('Comment', 10_000),
  }),
  sailpoint_get_task_status: operationSchema('sailpoint_get_task_status', {
    id: requiredString('Task ID'),
  }),
  sailpoint_load_accounts: operationSchema('sailpoint_load_accounts', {
    sourceId: requiredString('Source ID'),
    file: FileInputSchema.optional().nullable(),
    disableOptimization: z.boolean().optional(),
  }),
  sailpoint_load_entitlements: operationSchema('sailpoint_load_entitlements', {
    sourceId: requiredString('Source ID'),
    file: FileInputSchema.optional().nullable(),
  }),
} as const

export type SailPointOperationId = keyof typeof schemas

export const SAILPOINT_OPERATION_IDS = Object.freeze(Object.keys(schemas) as SailPointOperationId[])

export type SailPointInput = z.output<(typeof schemas)[SailPointOperationId]>

export function parseSailPointInput(
  toolId: string,
  input: unknown
): { success: true; data: SailPointInput } | { success: false; error: z.ZodError } | null {
  const schema = schemas[toolId as SailPointOperationId]
  if (!schema) return null
  const parsed = schema.safeParse(input)
  if (!parsed.success) return parsed
  return { success: true, data: parsed.data as SailPointInput }
}
