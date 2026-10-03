import { z } from 'zod'
import {
  ACCESS_REQUEST_STATUSES,
  accessRequestDiscoveryEntrySchema,
  accessRequestParamsSchema,
  accessRequestPreviewResponseSchema,
  accessRequestRecordSchema,
  accessRequestSettingsSchema,
  createAccessRequestBodySchema,
  resolveAccessRequestBodySchema,
} from '@/lib/api/contracts/access-requests'
import {
  noInputSchema,
  organizationIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2PaginationFields,
  v2SearchSchema,
  v2SortFields,
} from '@/lib/api/contracts/v2/shared'
import { ACCESS_REQUEST_TARGET_KINDS } from '@/ee/access-requests/lib/targets'

export const v2AccessRequestSchema = accessRequestRecordSchema.meta({ id: 'V2AccessRequest' })
export type V2AccessRequest = z.output<typeof v2AccessRequestSchema>
export const v2AccessRequestDiscoveryEntrySchema = accessRequestDiscoveryEntrySchema.meta({
  id: 'V2AccessRequestDiscoveryEntry',
})
export type V2AccessRequestDiscoveryEntry = z.output<typeof v2AccessRequestDiscoveryEntrySchema>
export const v2AccessRequestPreviewSchema = z.discriminatedUnion('resolutionKind', [
  accessRequestPreviewResponseSchema.options[0].meta({ id: 'V2PermissionAccessRequestPreview' }),
  accessRequestPreviewResponseSchema.options[1].meta({ id: 'V2CreditLimitAccessRequestPreview' }),
])
export type V2AccessRequestPreview = z.output<typeof v2AccessRequestPreviewSchema>

export const v2OrganizationAccessRequestParamsSchema = z.object({
  organizationId: organizationIdSchema.describe('Organization that owns the access requests.'),
})
export type V2OrganizationAccessRequestParams = z.input<
  typeof v2OrganizationAccessRequestParamsSchema
>
export const v2WorkspaceAccessRequestParamsSchema = z.object({
  workspaceId: workspaceIdSchema.describe('Workspace in which the acting user requests access.'),
})
export type V2WorkspaceAccessRequestParams = z.input<typeof v2WorkspaceAccessRequestParamsSchema>
export const v2OrganizationAccessRequestDetailParamsSchema =
  v2OrganizationAccessRequestParamsSchema.extend(accessRequestParamsSchema.shape)
export type V2OrganizationAccessRequestDetailParams = z.input<
  typeof v2OrganizationAccessRequestDetailParamsSchema
>
export const v2WorkspaceAccessRequestDetailParamsSchema =
  v2WorkspaceAccessRequestParamsSchema.extend(accessRequestParamsSchema.shape)
export type V2WorkspaceAccessRequestDetailParams = z.input<
  typeof v2WorkspaceAccessRequestDetailParamsSchema
>

export const v2ListAccessRequestsQuerySchema = z
  .object({
    status: z
      .enum(ACCESS_REQUEST_STATUSES)
      .optional()
      .describe('Filter by request status; omit to include all statuses.'),
    ...v2SortFields(['createdAt', 'targetLabel'] as const, {
      sortBy: 'createdAt',
      sortOrder: 'desc',
    }),
    ...v2PaginationFields({ description: 'Maximum access requests to return per page.' }),
  })
  .strict()
export type V2ListAccessRequestsQuery = z.input<typeof v2ListAccessRequestsQuerySchema>
export const v2ListOrganizationAccessRequestsQuerySchema = v2ListAccessRequestsQuerySchema
  .extend({
    search: v2SearchSchema.describe(
      'Case-insensitive substring match against the target label or requester name or email.'
    ),
  })
  .strict()
export type V2ListOrganizationAccessRequestsQuery = z.input<
  typeof v2ListOrganizationAccessRequestsQuerySchema
>
export const v2DiscoverAccessRequestsQuerySchema = z
  .object({
    search: v2SearchSchema.describe(
      'Case-insensitive substring match against the access item label.'
    ),
    targetKind: z
      .enum(ACCESS_REQUEST_TARGET_KINDS)
      .optional()
      .describe('Category of access to discover.'),
    state: z
      .enum(['allowed', 'requestable', 'unavailable'])
      .optional()
      .describe(
        'Filter by the acting user’s current access. Requestable items can be submitted for review.'
      ),
    ...v2SortFields(['label'] as const, { sortBy: 'label', sortOrder: 'asc' }),
    ...v2PaginationFields({ description: 'Maximum access items to return per page.' }),
  })
  .strict()
export type V2DiscoverAccessRequestsQuery = z.input<typeof v2DiscoverAccessRequestsQuerySchema>
export const v2CreateAccessRequestBodySchema = createAccessRequestBodySchema
  .omit({ scope: true })
  .extend({
    target: createAccessRequestBodySchema.shape.target.describe(
      'Target returned by Discover Workspace Access Requests or Discover Organization Access Requests. The target must currently be requestable.'
    ),
    reason: createAccessRequestBodySchema.shape.reason.describe(
      'Why the acting user needs this access.'
    ),
  })
  .strict()
export type V2CreateAccessRequestBody = z.input<typeof v2CreateAccessRequestBodySchema>
export const v2ResolveAccessRequestBodySchema = z.discriminatedUnion('action', [
  resolveAccessRequestBodySchema.options[0].extend({
    action: z
      .literal('apply')
      .describe('Apply the reviewed change to the governing group or member credit cap.'),
    expectedFingerprint:
      resolveAccessRequestBodySchema.options[0].shape.expectedFingerprint.describe(
        'Fingerprint from Preview Organization Access Request. Review its changes and impact before applying; a stale preview returns a conflict.'
      ),
    newLimitCredits: resolveAccessRequestBodySchema.options[0].shape.newLimitCredits.describe(
      'Required only for a usage-limit request: a whole-number credit cap greater than the current cap. Omit for permission requests.'
    ),
  }),
  resolveAccessRequestBodySchema.options[1].extend({
    action: z
      .literal('decline')
      .describe('Decline the request without changing permissions or credit limits.'),
    reason: resolveAccessRequestBodySchema.options[1].shape.reason.describe(
      'Required explanation for declining this request.'
    ),
  }),
])
export type V2ResolveAccessRequestBody = z.input<typeof v2ResolveAccessRequestBodySchema>
export const v2AccessRequestSettingsSchema = accessRequestSettingsSchema.extend({
  allowRequests: accessRequestSettingsSchema.shape.allowRequests.describe(
    'Allow new requests and approvals. Disabling requests preserves history and still allows cancellation and decline.'
  ),
})

export type V2AccessRequestSettings = z.input<typeof v2AccessRequestSettingsSchema>

export const v2AccessRequestSettingsDataSchema = v2AccessRequestSettingsSchema.meta({
  id: 'V2AccessRequestSettings',
})
export type V2AccessRequestSettingsData = z.output<typeof v2AccessRequestSettingsDataSchema>

export const v2DiscoverWorkspaceAccessRequestsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workspaces/[workspaceId]/access-requests/discovery',
  params: v2WorkspaceAccessRequestParamsSchema,
  query: v2DiscoverAccessRequestsQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2AccessRequestDiscoveryEntrySchema) },
})

export const v2ListMyWorkspaceAccessRequestsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workspaces/[workspaceId]/access-requests',
  params: v2WorkspaceAccessRequestParamsSchema,
  query: v2ListAccessRequestsQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2AccessRequestSchema) },
})

export const v2CreateWorkspaceAccessRequestContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workspaces/[workspaceId]/access-requests',
  params: v2WorkspaceAccessRequestParamsSchema,
  query: noInputSchema,
  body: v2CreateAccessRequestBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2AccessRequestSchema) },
})

export const v2CancelWorkspaceAccessRequestContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workspaces/[workspaceId]/access-requests/[requestId]/cancel',
  params: v2WorkspaceAccessRequestDetailParamsSchema,
  query: noInputSchema,
  response: { mode: 'json', schema: v2DataResponse(v2AccessRequestSchema) },
})

export const v2DiscoverOrganizationAccessRequestsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations/[organizationId]/access-requests/discovery',
  params: v2OrganizationAccessRequestParamsSchema,
  query: v2DiscoverAccessRequestsQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2AccessRequestDiscoveryEntrySchema) },
})

export const v2ListMyOrganizationAccessRequestsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations/[organizationId]/access-requests/mine',
  params: v2OrganizationAccessRequestParamsSchema,
  query: v2ListAccessRequestsQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2AccessRequestSchema) },
})

export const v2CreateOrganizationAccessRequestContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/organizations/[organizationId]/access-requests',
  params: v2OrganizationAccessRequestParamsSchema,
  query: noInputSchema,
  body: v2CreateAccessRequestBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2AccessRequestSchema) },
})

export const v2CancelOrganizationAccessRequestContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/organizations/[organizationId]/access-requests/[requestId]/cancel',
  params: v2OrganizationAccessRequestDetailParamsSchema,
  query: noInputSchema,
  response: { mode: 'json', schema: v2DataResponse(v2AccessRequestSchema) },
})

export const v2ListOrganizationAccessRequestsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations/[organizationId]/access-requests',
  params: v2OrganizationAccessRequestParamsSchema,
  query: v2ListOrganizationAccessRequestsQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2AccessRequestSchema) },
})

export const v2PreviewOrganizationAccessRequestContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations/[organizationId]/access-requests/[requestId]/preview',
  params: v2OrganizationAccessRequestDetailParamsSchema,
  query: noInputSchema,
  response: { mode: 'json', schema: v2DataResponse(v2AccessRequestPreviewSchema) },
})

export const v2ResolveOrganizationAccessRequestContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/organizations/[organizationId]/access-requests/[requestId]/resolve',
  params: v2OrganizationAccessRequestDetailParamsSchema,
  query: noInputSchema,
  body: v2ResolveAccessRequestBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2AccessRequestSchema) },
})

export const v2GetOrganizationAccessRequestSettingsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations/[organizationId]/access-requests/settings',
  params: v2OrganizationAccessRequestParamsSchema,
  query: noInputSchema,
  response: { mode: 'json', schema: v2DataResponse(v2AccessRequestSettingsDataSchema) },
})

export const v2UpdateOrganizationAccessRequestSettingsContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/organizations/[organizationId]/access-requests/settings',
  params: v2OrganizationAccessRequestParamsSchema,
  query: noInputSchema,
  body: v2AccessRequestSettingsSchema,
  response: { mode: 'json', schema: v2DataResponse(v2AccessRequestSettingsDataSchema) },
})
