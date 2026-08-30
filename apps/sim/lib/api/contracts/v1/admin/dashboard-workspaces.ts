import { z } from 'zod'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import {
  adminV1IdParamsSchema,
  adminV1PaginationMetaSchema,
  lastQueryValue,
} from '@/lib/api/contracts/v1/admin/shared'

export const adminDashboardWorkspaceSearchQuerySchema = z.object({
  search: z.preprocess(
    lastQueryValue,
    z.string({ error: 'search is required' }).trim().min(1).max(200)
  ),
  limit: z
    .preprocess((value) => {
      const queryValue = lastQueryValue(value)
      return typeof queryValue === 'string' ? Number.parseInt(queryValue, 10) : queryValue
    }, z.number().int().min(1).max(50).catch(20))
    .catch(20),
  offset: z
    .preprocess((value) => {
      const queryValue = lastQueryValue(value)
      return typeof queryValue === 'string' ? Number.parseInt(queryValue, 10) : queryValue
    }, z.number().int().min(0).catch(0))
    .catch(0),
})

export const adminDashboardWorkspacePreflightQuerySchema = z.object({
  destinationOrganizationId: z.preprocess(
    lastQueryValue,
    z.string({ error: 'destinationOrganizationId is required' }).min(1).max(200)
  ),
})

export const adminDashboardWorkspaceMoveBodySchema = z.object({
  operationId: z.string().uuid(),
  destinationOrganizationId: z.string().min(1).max(200),
  expectedOwnerId: z.string().min(1).max(200).optional(),
})

export const adminDashboardWorkspaceMoveOperationQuerySchema = z.object({
  destinationOrganizationId: z.preprocess(
    lastQueryValue,
    z.string({ error: 'destinationOrganizationId is required' }).min(1).max(200)
  ),
  expectedOwnerId: z.preprocess(lastQueryValue, z.string().min(1).max(200).optional()),
})

export const adminDashboardWorkspaceMoveFollowUpRetryBodySchema = z.object({
  destinationOrganizationId: z.string().min(1).max(200),
  expectedOwnerId: z.string().min(1).max(200).optional(),
})

const adminDashboardWorkspaceCandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  ownerEmail: z.string(),
  workspaceMode: z.string(),
  organizationId: z.string().nullable(),
  /** Name of the organization that currently owns the workspace, if any. */
  organizationName: z.string().nullable(),
  billedAccountUserId: z.string(),
  /** Archived workspaces are movable; the flag lets admin UIs label them. */
  archived: z.boolean(),
  /**
   * Non-null when the workspace cannot be moved. Ineligible rows are returned
   * rather than filtered out so the admin learns the workspace exists and why
   * it is stuck, instead of an empty result they cannot act on.
   */
  ineligibleReason: z.string().nullable().optional(),
})

/** Usage split so the UI can separate what leaves from what breaks behind. */
const adminDashboardCustomBlockUsageSchema = z.object({
  live: z.number().int().min(0),
  deployed: z.number().int().min(0),
})

const adminDashboardWorkspaceSourceImpactSchema = z.object({
  unpublishedCustomBlocks: z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
        name: z.string(),
        movingWorkspaceUsage: adminDashboardCustomBlockUsageSchema,
        sourceOrgElsewhereUsage: adminDashboardCustomBlockUsageSchema,
      })
    )
    .max(500),
  /** Non-empty means the move is blocked until the fork is disconnected. */
  blockingForkEdges: z
    .array(
      z.object({
        workspaceId: z.string(),
        name: z.string(),
        organizationId: z.string().nullable(),
        direction: z.enum(['parent', 'child']),
      })
    )
    .max(500),
  detachedPermissionGroups: z
    .array(z.object({ permissionGroupId: z.string(), name: z.string() }))
    .max(500),
  strippedRetentionRules: z.object({
    piiRedactionRules: z.number().int().min(0),
    retentionOverrides: z.number().int().min(0),
  }),
  retainedCollaboratorCaps: z
    .array(
      z.object({
        userId: z.string(),
        email: z.string(),
        sourceOrgLimitDollars: z.number().nullable(),
      })
    )
    .max(1000),
  brandingChanges: z.boolean(),
  /**
   * Rows omitted to keep the response inside the array bounds above. Non-null
   * means the lists are incomplete and the notice says so.
   */
  truncated: z
    .object({
      customBlocks: z.number().int().min(0),
      permissionGroups: z.number().int().min(0),
      collaboratorCaps: z.number().int().min(0),
      forkEdges: z.number().int().min(0),
      credentials: z.number().int().min(0),
      environmentVariableKeys: z.number().int().min(0),
    })
    .nullable(),
})

/** Secrets that travel with the workspace. Never carries secret material. */
const adminDashboardWorkspaceCredentialsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        displayName: z.string(),
        type: z.string(),
        backedBySourceOrgMember: z.boolean(),
      })
    )
    .max(1000),
  credentialGroupCount: z.number().int().min(0),
  /** Variable names only — values are never sent. */
  environmentVariableKeys: z.array(z.string()).max(1000),
  byokKeyCount: z.number().int().min(0),
  /** Rows omitted to stay within the bounds above. */
  truncatedCredentials: z.number().int().min(0),
  truncatedEnvironmentVariableKeys: z.number().int().min(0),
})

const adminDashboardWorkspacePreflightSchema = z.object({
  workspace: adminDashboardWorkspaceCandidateSchema,
  /** `null` for a personal or grandfathered source. */
  sourceOrganization: z
    .object({
      id: z.string(),
      name: z.string(),
      ownerId: z.string().nullable(),
      ownerName: z.string().nullable(),
      ownerEmail: z.string().nullable(),
    })
    .nullable(),
  destinationOrganization: z.object({
    id: z.string(),
    name: z.string(),
    ownerId: z.string(),
    ownerName: z.string(),
    ownerEmail: z.string(),
  }),
  collaborators: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      email: z.string(),
      permission: z.enum(['admin', 'write', 'read']),
      organizationMember: z.boolean(),
      /** Retains access after the move, as an external collaborator. */
      sourceOrganizationMember: z.boolean(),
    })
  ),
  invitations: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      membershipIntent: z.enum(['internal', 'external']),
      permission: z.enum(['admin', 'write', 'read']),
      workspaceGrantCount: z.number().int().min(1),
    })
  ),
  sourceOrganizationImpact: adminDashboardWorkspaceSourceImpactSchema,
  credentials: adminDashboardWorkspaceCredentialsSchema,
  entitlements: z.object({
    sourceIsEnterprise: z.boolean(),
    destinationIsEnterprise: z.boolean(),
    capabilitiesLost: z.array(z.string()).max(50),
  }),
  /** Non-empty means the move will throw; the UI must not offer a confirm. */
  blockers: z.array(z.string()).max(20),
  /** Advisory consequences worth reading, which never block. */
  notices: z.array(z.string()).max(20),
  warning: z.string().nullable(),
})

const adminDashboardWorkspaceMoveOperationSchema = adminDashboardWorkspacePreflightSchema.extend({
  operationId: z.string().uuid(),
  followUpJobs: z.object({
    selected: z.number().int().min(0),
    completed: z.number().int().min(0),
    pending: z.number().int().min(0),
    failedCount: z.number().int().min(0),
    failed: z
      .array(
        z.object({
          eventId: z.string(),
          invitationId: z.string(),
          error: z.string().nullable(),
        })
      )
      .max(100),
  }),
})

const adminDashboardWorkspaceSearchResponseSchema = z.object({
  data: z.array(adminDashboardWorkspaceCandidateSchema),
  pagination: adminV1PaginationMetaSchema,
})

const adminDashboardWorkspacePreflightResponseSchema = z.object({
  data: adminDashboardWorkspacePreflightSchema,
})

const adminDashboardWorkspaceMoveResponseSchema = z.object({
  data: adminDashboardWorkspaceMoveOperationSchema,
})

export const adminDashboardWorkspaceSearchContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/dashboard/workspaces',
  query: adminDashboardWorkspaceSearchQuerySchema,
  response: { mode: 'json', schema: adminDashboardWorkspaceSearchResponseSchema },
})

export const adminDashboardWorkspacePreflightContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/dashboard/workspaces/[id]/preflight',
  params: adminV1IdParamsSchema,
  query: adminDashboardWorkspacePreflightQuerySchema,
  response: { mode: 'json', schema: adminDashboardWorkspacePreflightResponseSchema },
})

export const adminDashboardWorkspaceMoveContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/workspaces/[id]/move',
  params: adminV1IdParamsSchema,
  body: adminDashboardWorkspaceMoveBodySchema,
  response: { mode: 'json', schema: adminDashboardWorkspaceMoveResponseSchema },
})

export const adminDashboardWorkspaceMoveOperationContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/dashboard/workspaces/[id]/move-operations/[operationId]',
  params: adminV1IdParamsSchema.extend({ operationId: z.string().uuid() }),
  query: adminDashboardWorkspaceMoveOperationQuerySchema,
  response: { mode: 'json', schema: adminDashboardWorkspaceMoveResponseSchema },
})

export const adminDashboardRetryWorkspaceMoveFollowUpContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/dashboard/workspaces/[id]/move-operations/[operationId]/follow-up-jobs/[jobId]/retry',
  params: adminV1IdParamsSchema.extend({
    operationId: z.string().uuid(),
    jobId: z.string().min(1),
  }),
  body: adminDashboardWorkspaceMoveFollowUpRetryBodySchema,
  response: { mode: 'json', schema: adminDashboardWorkspaceMoveResponseSchema },
})

export type AdminDashboardWorkspaceSearchResponse = ContractJsonResponse<
  typeof adminDashboardWorkspaceSearchContract
>
export type AdminDashboardWorkspacePreflightResponse = ContractJsonResponse<
  typeof adminDashboardWorkspacePreflightContract
>
export type AdminDashboardWorkspaceMoveBody = z.input<typeof adminDashboardWorkspaceMoveBodySchema>
export type AdminDashboardWorkspaceMoveOperationResponse = ContractJsonResponse<
  typeof adminDashboardWorkspaceMoveOperationContract
>
