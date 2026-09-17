import { z } from 'zod'
import { organizationIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  ACCESS_REQUEST_MAX_ID_LENGTH,
  ACCESS_REQUEST_MAX_OFFSET,
  ACCESS_REQUEST_MAX_SEARCH_LENGTH,
} from '@/lib/permission-access-requests/constants'
import {
  storedAccessRequestDecisionSchema,
  storedAccessRequestPolicyChangeSchema,
  storedAccessRequestPolicyValueSchema,
  storedAccessRequestTargetSchema,
} from '@/lib/permission-access-requests/schemas'
import {
  ACCESS_REQUEST_TARGET_KINDS,
  type AccessRequestScope as DomainAccessRequestScope,
} from '@/lib/permission-groups/access-requests/targets'
import { PERMISSION_GROUP_FIELDS } from '@/lib/permission-groups/fields'

export const ACCESS_REQUEST_STATUSES = [
  'pending',
  'fulfilled',
  'declined',
  'cancelled',
  'closed',
] as const

export const ACCESS_REQUEST_PAGE_SIZE = 50
export const ACCESS_REQUEST_MAX_PAGE_SIZE = 100

const requestIdSchema = z
  .string()
  .min(1, 'Request ID cannot be empty')
  .max(ACCESS_REQUEST_MAX_ID_LENGTH)
const reasonSchema = z.string().trim().max(1000, 'Reason must be at most 1000 characters')
const fingerprintSchema = z.string().min(1, 'A current preview is required').max(128)
const usageLimitSchema = z
  .number()
  .int('Credit limit must be a whole number')
  .positive()
  .max(Number.MAX_SAFE_INTEGER)

export const accessRequestTargetSchema = storedAccessRequestTargetSchema
export type AccessRequestTarget = z.output<typeof accessRequestTargetSchema>

export const accessRequestScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workspace'), workspaceId: workspaceIdSchema }).strict(),
  z.object({ kind: z.literal('organization'), organizationId: organizationIdSchema }).strict(),
]) satisfies z.ZodType<DomainAccessRequestScope>
export type AccessRequestScope = z.output<typeof accessRequestScopeSchema>

const paginationShape = {
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(ACCESS_REQUEST_MAX_PAGE_SIZE)
    .default(ACCESS_REQUEST_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).max(ACCESS_REQUEST_MAX_OFFSET).default(0),
}

const discoveryShape = {
  ...paginationShape,
  search: z.string().trim().max(ACCESS_REQUEST_MAX_SEARCH_LENGTH).optional(),
  targetKind: z.enum(ACCESS_REQUEST_TARGET_KINDS).optional(),
  targetKey: z.string().min(1, 'Target key cannot be empty').max(2048).optional(),
  state: z.enum(['allowed', 'requestable', 'unavailable']).optional(),
}

export const discoverAccessRequestsQuerySchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('workspace'), workspaceId: workspaceIdSchema, ...discoveryShape })
    .strict(),
  z
    .object({
      kind: z.literal('organization'),
      organizationId: organizationIdSchema,
      ...discoveryShape,
    })
    .strict(),
])
export type DiscoverAccessRequestsQuery = z.input<typeof discoverAccessRequestsQuerySchema>
export type ParsedDiscoverAccessRequestsQuery = z.output<typeof discoverAccessRequestsQuerySchema>

export const listMyAccessRequestsQuerySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('workspace'),
      workspaceId: workspaceIdSchema,
      ...paginationShape,
      requestId: requestIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('organization'),
      organizationId: organizationIdSchema,
      ...paginationShape,
      requestId: requestIdSchema.optional(),
    })
    .strict(),
])
export type ListMyAccessRequestsQuery = z.input<typeof listMyAccessRequestsQuerySchema>

export const createAccessRequestBodySchema = z
  .object({
    scope: accessRequestScopeSchema,
    target: accessRequestTargetSchema,
    reason: reasonSchema.default(''),
  })
  .strict()
export type CreateAccessRequestBody = z.input<typeof createAccessRequestBodySchema>

export const accessRequestParamsSchema = z.object({ requestId: requestIdSchema })
export type AccessRequestParams = z.input<typeof accessRequestParamsSchema>

export const cancelAccessRequestBodySchema = z.object({ scope: accessRequestScopeSchema }).strict()
export type CancelAccessRequestBody = z.input<typeof cancelAccessRequestBodySchema>

export const organizationAccessRequestParamsSchema = z.object({
  id: organizationIdSchema,
})
export type OrganizationAccessRequestParams = z.input<typeof organizationAccessRequestParamsSchema>

export const organizationAccessRequestDetailParamsSchema =
  organizationAccessRequestParamsSchema.extend({
    requestId: requestIdSchema,
  })
export type OrganizationAccessRequestDetailParams = z.input<
  typeof organizationAccessRequestDetailParamsSchema
>

export const listOrganizationAccessRequestsQuerySchema = z
  .object({
    ...paginationShape,
    status: z.enum(ACCESS_REQUEST_STATUSES).optional(),
  })
  .strict()
export type ListOrganizationAccessRequestsQuery = z.input<
  typeof listOrganizationAccessRequestsQuerySchema
>

export const resolveAccessRequestBodySchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('apply'),
      expectedFingerprint: fingerprintSchema,
      newLimitCredits: usageLimitSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('decline'),
      reason: reasonSchema.min(1, 'Explain why this request was declined'),
    })
    .strict(),
])
export type ResolveAccessRequestBody = z.input<typeof resolveAccessRequestBodySchema>

export const accessRequestSettingsSchema = z.object({ allowRequests: z.boolean() }).strict()
export type AccessRequestSettings = z.output<typeof accessRequestSettingsSchema>
export type UpdateAccessRequestSettingsBody = z.input<typeof accessRequestSettingsSchema>

export const accessRequestRecordSchema = z.object({
  id: requestIdSchema,
  organizationId: organizationIdSchema,
  workspaceId: workspaceIdSchema.nullable(),
  target: accessRequestTargetSchema,
  targetLabel: z.string().min(1).max(512),
  reason: reasonSchema,
  status: z.enum(ACCESS_REQUEST_STATUSES),
  decisionReason: reasonSchema.nullable(),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  groupName: z.string().nullable(),
  requester: z.object({
    id: z.string().min(1).max(128),
    name: z.string().nullable(),
    email: z.string().max(320),
  }),
})
export type AccessRequestRecord = z.output<typeof accessRequestRecordSchema>
export type AccessRequestStatus = AccessRequestRecord['status']

export const accessRequestDiscoveryEntrySchema = z.object({
  target: accessRequestTargetSchema,
  label: z.string().min(1).max(512),
  state: z.enum(['allowed', 'requestable', 'unavailable']),
  reason: z.string().max(1000).nullable(),
  pendingRequestId: requestIdSchema.nullable(),
})
export type AccessRequestDiscoveryEntry = z.output<typeof accessRequestDiscoveryEntrySchema>

export const discoverAccessRequestsResponseSchema = z.object({
  enabled: z.boolean(),
  organizationId: organizationIdSchema.nullable(),
  entries: z.array(accessRequestDiscoveryEntrySchema).max(ACCESS_REQUEST_MAX_PAGE_SIZE),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
})
export type DiscoverAccessRequestsResponse = z.output<typeof discoverAccessRequestsResponseSchema>

export const accessRequestListResponseSchema = z.object({
  requests: z.array(accessRequestRecordSchema).max(ACCESS_REQUEST_MAX_PAGE_SIZE),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
})
export type AccessRequestListResponse = z.output<typeof accessRequestListResponseSchema>

export const accessRequestResponseSchema = z.object({ request: accessRequestRecordSchema })
export type AccessRequestResponse = z.output<typeof accessRequestResponseSchema>

export const accessRequestPolicyValueSchema = storedAccessRequestPolicyValueSchema
export const accessRequestPolicyChangeSchema = storedAccessRequestPolicyChangeSchema
export type AccessRequestPolicyChange = z.output<typeof accessRequestPolicyChangeSchema>
export const accessRequestDecisionSchema = storedAccessRequestDecisionSchema
export type AccessRequestDecision = z.output<typeof accessRequestDecisionSchema>

const previewShape = {
  newLimitCredits: z.number().finite().nonnegative().nullable(),
  request: accessRequestRecordSchema,
  changes: z
    .array(accessRequestPolicyChangeSchema)
    .max(Object.keys(PERMISSION_GROUP_FIELDS).length),
  impact: storedAccessRequestDecisionSchema.shape.impact,
  fingerprint: fingerprintSchema,
  canApply: z.boolean(),
  unavailableReason: z.string().max(1000).nullable(),
}

export const accessRequestPreviewResponseSchema = z.discriminatedUnion('resolutionKind', [
  z.object({
    ...previewShape,
    resolutionKind: z.literal('permission'),
    group: storedAccessRequestDecisionSchema.shape.group,
    currentLimitCredits: z.null(),
  }),
  z.object({
    ...previewShape,
    resolutionKind: z.literal('usage_limit'),
    group: z.null(),
    currentLimitCredits: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  }),
])
export type AccessRequestPreviewResponse = z.output<typeof accessRequestPreviewResponseSchema>

export const discoverAccessRequestsContract = defineRouteContract({
  method: 'GET',
  path: '/api/access-requests/discovery',
  query: discoverAccessRequestsQuerySchema,
  response: { mode: 'json', schema: discoverAccessRequestsResponseSchema },
})

export const listMyAccessRequestsContract = defineRouteContract({
  method: 'GET',
  path: '/api/access-requests',
  query: listMyAccessRequestsQuerySchema,
  response: { mode: 'json', schema: accessRequestListResponseSchema },
})

export const createAccessRequestContract = defineRouteContract({
  method: 'POST',
  path: '/api/access-requests',
  body: createAccessRequestBodySchema,
  response: { mode: 'json', schema: accessRequestResponseSchema },
})

export const cancelAccessRequestContract = defineRouteContract({
  method: 'POST',
  path: '/api/access-requests/[requestId]/cancel',
  params: accessRequestParamsSchema,
  body: cancelAccessRequestBodySchema,
  response: { mode: 'json', schema: accessRequestResponseSchema },
})

export const listOrganizationAccessRequestsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/access-requests',
  params: organizationAccessRequestParamsSchema,
  query: listOrganizationAccessRequestsQuerySchema,
  response: { mode: 'json', schema: accessRequestListResponseSchema },
})

export const previewAccessRequestContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/access-requests/[requestId]/preview',
  params: organizationAccessRequestDetailParamsSchema,
  response: { mode: 'json', schema: accessRequestPreviewResponseSchema },
})

export const resolveAccessRequestContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/access-requests/[requestId]/resolve',
  params: organizationAccessRequestDetailParamsSchema,
  body: resolveAccessRequestBodySchema,
  response: { mode: 'json', schema: accessRequestResponseSchema },
})

export const getAccessRequestSettingsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/access-requests/settings',
  params: organizationAccessRequestParamsSchema,
  response: { mode: 'json', schema: accessRequestSettingsSchema },
})

export const updateAccessRequestSettingsContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/organizations/[id]/access-requests/settings',
  params: organizationAccessRequestParamsSchema,
  body: accessRequestSettingsSchema,
  response: { mode: 'json', schema: accessRequestSettingsSchema },
})
