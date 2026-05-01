import { z } from 'zod'
import {
  type ContractJsonResponse,
  type ContractQuery,
  type ContractQueryInput,
  defineRouteContract,
} from '@/lib/api/contracts/types'
import {
  adminV1PaginationMetaSchema,
  adminV1QueryStringSchema,
  adminV1SingleResponseSchema,
} from '@/lib/api/contracts/v1/admin/shared'

export const adminV1PermissionGroupSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string().nullable(),
  organizationId: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  memberCount: z.number(),
  createdAt: z.string(),
  createdByUserId: z.string(),
  createdByEmail: z.string().nullable(),
})

export const adminV1AccessControlQuerySchema = z.object({
  workspaceId: adminV1QueryStringSchema,
  organizationId: adminV1QueryStringSchema,
})

export const adminV1AccessControlDeleteQuerySchema = adminV1AccessControlQuerySchema
  .extend({
    reason: adminV1QueryStringSchema.default('Enterprise plan churn cleanup'),
  })
  .refine((query) => query.workspaceId || query.organizationId, {
    error: 'workspaceId or organizationId is required',
  })

const adminV1AccessControlListResultSchema = z.object({
  data: z.array(adminV1PermissionGroupSchema),
  pagination: adminV1PaginationMetaSchema,
})

const adminV1AccessControlDeleteResultSchema = z.object({
  success: z.literal(true),
  deletedCount: z.number(),
  membersRemoved: z.number(),
  reason: z.string().optional(),
  message: z.string().optional(),
})

export const adminV1ListAccessControlContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/access-control',
  query: adminV1AccessControlQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1AccessControlListResultSchema),
  },
})

export const adminV1DeleteAccessControlContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/admin/access-control',
  query: adminV1AccessControlDeleteQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1AccessControlDeleteResultSchema),
  },
})

export type AdminV1PermissionGroup = z.output<typeof adminV1PermissionGroupSchema>
export type AdminV1ListAccessControlQueryInput = ContractQueryInput<
  typeof adminV1ListAccessControlContract
>
export type AdminV1ListAccessControlQuery = ContractQuery<typeof adminV1ListAccessControlContract>
export type AdminV1DeleteAccessControlQueryInput = ContractQueryInput<
  typeof adminV1DeleteAccessControlContract
>
export type AdminV1DeleteAccessControlQuery = ContractQuery<
  typeof adminV1DeleteAccessControlContract
>
export type AdminV1ListAccessControlResponse = ContractJsonResponse<
  typeof adminV1ListAccessControlContract
>
export type AdminV1DeleteAccessControlResponse = ContractJsonResponse<
  typeof adminV1DeleteAccessControlContract
>
