import { z } from 'zod'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import { adminV1IdParamsSchema, lastQueryValue } from '@/lib/api/contracts/v1/admin/shared'

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
})

export const adminDashboardWorkspacePreflightQuerySchema = z.object({
  destinationOrganizationId: z.preprocess(
    lastQueryValue,
    z.string({ error: 'destinationOrganizationId is required' }).min(1).max(200)
  ),
})

export const adminDashboardWorkspaceMoveBodySchema = z.object({
  destinationOrganizationId: z.string().min(1).max(200),
})

const adminDashboardWorkspaceCandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  ownerEmail: z.string(),
  workspaceMode: z.string(),
  organizationId: z.string().nullable(),
  billedAccountUserId: z.string(),
})

const adminDashboardWorkspacePreflightSchema = z.object({
  workspace: adminDashboardWorkspaceCandidateSchema,
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
  warning: z.string().nullable(),
})

const adminDashboardWorkspaceSearchResponseSchema = z.object({
  data: z.array(adminDashboardWorkspaceCandidateSchema),
})

const adminDashboardWorkspacePreflightResponseSchema = z.object({
  data: adminDashboardWorkspacePreflightSchema,
})

const adminDashboardWorkspaceMoveResponseSchema = z.object({
  data: adminDashboardWorkspacePreflightSchema.extend({
    invitationEmailFailures: z.array(z.string()),
  }),
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

export type AdminDashboardWorkspaceSearchResponse = ContractJsonResponse<
  typeof adminDashboardWorkspaceSearchContract
>
export type AdminDashboardWorkspacePreflightResponse = ContractJsonResponse<
  typeof adminDashboardWorkspacePreflightContract
>
export type AdminDashboardWorkspaceMoveBody = z.input<typeof adminDashboardWorkspaceMoveBodySchema>
