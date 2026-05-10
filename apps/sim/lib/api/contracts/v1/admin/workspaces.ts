import { z } from 'zod'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import {
  adminV1ExportFormatQuerySchema,
  adminV1IdParamsSchema,
  adminV1ListResponseSchema,
  adminV1PaginationQuerySchema,
  adminV1QueryStringSchema,
  adminV1SingleResponseSchema,
  lastQueryValue,
} from '@/lib/api/contracts/v1/admin/shared'
import {
  adminV1ImportResultSchema,
  adminV1WorkflowSchema,
} from '@/lib/api/contracts/v1/admin/workflows'
import { workspacePermissionSchema } from '@/lib/api/contracts/workspaces'

export const adminV1WorkspaceMemberParamsSchema = adminV1IdParamsSchema.extend({
  memberId: z.string().min(1),
})

export const adminV1DeleteWorkspaceMemberQuerySchema = z.object({
  userId: z.preprocess(
    lastQueryValue,
    z
      .string({ error: 'userId query parameter is required' })
      .min(1, { error: 'userId query parameter is required' })
  ),
})

export const adminV1WorkspaceImportQuerySchema = z.object({
  createFolders: z
    .preprocess(lastQueryValue, z.enum(['true', 'false']).catch('true'))
    .transform((value) => value !== 'false'),
  rootFolderName: adminV1QueryStringSchema,
})

export const adminV1WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const adminV1WorkspaceDetailSchema = adminV1WorkspaceSchema.extend({
  workflowCount: z.number(),
  folderCount: z.number(),
})

export const adminV1FolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  color: z.string().nullable(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const adminV1WorkspaceMemberSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
  permissions: workspacePermissionSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  userName: z.string(),
  userEmail: z.string(),
  userImage: z.string().nullable(),
})

export const adminV1WorkspaceImportResponseSchema = z.object({
  imported: z.number(),
  failed: z.number(),
  results: z.array(adminV1ImportResultSchema),
})

export const adminV1WorkspaceMemberBodySchema = z.object({
  userId: z.string({ error: 'userId is required' }).min(1, { error: 'userId is required' }),
  permissions: workspacePermissionSchema.refine((value) => value !== null, {
    error: 'permissions must be "admin", "write", or "read"',
  }),
})

export const adminV1UpdateWorkspaceMemberBodySchema = z.object({
  permissions: workspacePermissionSchema.refine((value) => value !== null, {
    error: 'permissions must be "admin", "write", or "read"',
  }),
})

export const adminV1WorkspaceImportBodySchema = z.object({
  workflows: z.array(
    z.object({
      content: z.union([z.string(), z.record(z.string(), z.unknown())]),
      name: z.string().optional(),
      folderPath: z.array(z.string()).optional(),
    }),
    { error: 'Invalid JSON body. Expected { workflows: [...] }' }
  ),
})

const adminV1DeleteWorkspaceWorkflowsResultSchema = z.object({
  success: z.literal(true),
  deleted: z.number(),
})

const adminV1WorkspaceMemberMutationResultSchema = adminV1WorkspaceMemberSchema.extend({
  action: z.enum(['created', 'updated', 'already_member']),
})

const adminV1DeleteWorkspaceMemberResultSchema = z.object({
  removed: z.literal(true),
  userId: z.string(),
  workspaceId: z.string(),
})

const adminV1RemoveWorkspaceMemberResultSchema = z.object({
  removed: z.literal(true),
  memberId: z.string(),
  userId: z.string(),
  workspaceId: z.string(),
})

export const adminV1ListWorkspacesContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workspaces',
  query: adminV1PaginationQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1ListResponseSchema(adminV1WorkspaceSchema),
  },
})

export const adminV1GetWorkspaceContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workspaces/[id]',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1WorkspaceDetailSchema),
  },
})

export const adminV1ListWorkspaceWorkflowsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workspaces/[id]/workflows',
  params: adminV1IdParamsSchema,
  query: adminV1PaginationQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1ListResponseSchema(adminV1WorkflowSchema),
  },
})

export const adminV1DeleteWorkspaceWorkflowsContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/admin/workspaces/[id]/workflows',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1DeleteWorkspaceWorkflowsResultSchema,
  },
})

export const adminV1ListWorkspaceFoldersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workspaces/[id]/folders',
  params: adminV1IdParamsSchema,
  query: adminV1PaginationQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1ListResponseSchema(adminV1FolderSchema),
  },
})

export const adminV1ExportWorkspaceContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workspaces/[id]/export',
  params: adminV1IdParamsSchema,
  query: adminV1ExportFormatQuerySchema,
  response: {
    mode: 'binary',
  },
})

export const adminV1ImportWorkspaceContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/workspaces/[id]/import',
  params: adminV1IdParamsSchema,
  query: adminV1WorkspaceImportQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1WorkspaceImportResponseSchema,
  },
})

export const adminV1ListWorkspaceMembersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workspaces/[id]/members',
  params: adminV1IdParamsSchema,
  query: adminV1PaginationQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1ListResponseSchema(adminV1WorkspaceMemberSchema),
  },
})

export const adminV1CreateWorkspaceMemberContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/workspaces/[id]/members',
  params: adminV1IdParamsSchema,
  body: adminV1WorkspaceMemberBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1WorkspaceMemberMutationResultSchema),
  },
})

export const adminV1DeleteWorkspaceMemberContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/admin/workspaces/[id]/members',
  params: adminV1IdParamsSchema,
  query: adminV1DeleteWorkspaceMemberQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1DeleteWorkspaceMemberResultSchema),
  },
})

export const adminV1GetWorkspaceMemberContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workspaces/[id]/members/[memberId]',
  params: adminV1WorkspaceMemberParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1WorkspaceMemberSchema),
  },
})

export const adminV1UpdateWorkspaceMemberContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v1/admin/workspaces/[id]/members/[memberId]',
  params: adminV1WorkspaceMemberParamsSchema,
  body: adminV1UpdateWorkspaceMemberBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1WorkspaceMemberSchema),
  },
})

export const adminV1RemoveWorkspaceMemberContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/admin/workspaces/[id]/members/[memberId]',
  params: adminV1WorkspaceMemberParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1RemoveWorkspaceMemberResultSchema),
  },
})

export const adminV1ExportFolderContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/folders/[id]/export',
  params: adminV1IdParamsSchema,
  query: adminV1ExportFormatQuerySchema,
  response: {
    mode: 'binary',
  },
})

export type AdminV1WorkspaceMemberParamsInput = z.input<typeof adminV1WorkspaceMemberParamsSchema>
export type AdminV1WorkspaceMemberParams = z.output<typeof adminV1WorkspaceMemberParamsSchema>
export type AdminV1DeleteWorkspaceMemberQueryInput = z.input<
  typeof adminV1DeleteWorkspaceMemberQuerySchema
>
export type AdminV1DeleteWorkspaceMemberQuery = z.output<
  typeof adminV1DeleteWorkspaceMemberQuerySchema
>
export type AdminV1WorkspaceImportQueryInput = z.input<typeof adminV1WorkspaceImportQuerySchema>
export type AdminV1WorkspaceImportQuery = z.output<typeof adminV1WorkspaceImportQuerySchema>
export type AdminV1WorkspaceMemberBodyInput = z.input<typeof adminV1WorkspaceMemberBodySchema>
export type AdminV1WorkspaceMemberBody = z.output<typeof adminV1WorkspaceMemberBodySchema>
export type AdminV1UpdateWorkspaceMemberBodyInput = z.input<
  typeof adminV1UpdateWorkspaceMemberBodySchema
>
export type AdminV1UpdateWorkspaceMemberBody = z.output<
  typeof adminV1UpdateWorkspaceMemberBodySchema
>
export type AdminV1WorkspaceImportBodyInput = z.input<typeof adminV1WorkspaceImportBodySchema>
export type AdminV1WorkspaceImportBody = z.output<typeof adminV1WorkspaceImportBodySchema>
export type AdminV1Workspace = z.output<typeof adminV1WorkspaceSchema>
export type AdminV1WorkspaceDetail = z.output<typeof adminV1WorkspaceDetailSchema>
export type AdminV1Folder = z.output<typeof adminV1FolderSchema>
export type AdminV1WorkspaceMember = z.output<typeof adminV1WorkspaceMemberSchema>
export type AdminV1WorkspaceImportResponseBody = z.output<
  typeof adminV1WorkspaceImportResponseSchema
>
export type AdminV1ListWorkspacesResponse = ContractJsonResponse<
  typeof adminV1ListWorkspacesContract
>
export type AdminV1GetWorkspaceResponse = ContractJsonResponse<typeof adminV1GetWorkspaceContract>
export type AdminV1ListWorkspaceWorkflowsResponse = ContractJsonResponse<
  typeof adminV1ListWorkspaceWorkflowsContract
>
export type AdminV1DeleteWorkspaceWorkflowsResponse = ContractJsonResponse<
  typeof adminV1DeleteWorkspaceWorkflowsContract
>
export type AdminV1ListWorkspaceFoldersResponse = ContractJsonResponse<
  typeof adminV1ListWorkspaceFoldersContract
>
export type AdminV1ImportWorkspaceResponse = ContractJsonResponse<
  typeof adminV1ImportWorkspaceContract
>
export type AdminV1ListWorkspaceMembersResponse = ContractJsonResponse<
  typeof adminV1ListWorkspaceMembersContract
>
export type AdminV1CreateWorkspaceMemberResponse = ContractJsonResponse<
  typeof adminV1CreateWorkspaceMemberContract
>
export type AdminV1DeleteWorkspaceMemberResponse = ContractJsonResponse<
  typeof adminV1DeleteWorkspaceMemberContract
>
export type AdminV1GetWorkspaceMemberResponse = ContractJsonResponse<
  typeof adminV1GetWorkspaceMemberContract
>
export type AdminV1UpdateWorkspaceMemberResponse = ContractJsonResponse<
  typeof adminV1UpdateWorkspaceMemberContract
>
export type AdminV1RemoveWorkspaceMemberResponse = ContractJsonResponse<
  typeof adminV1RemoveWorkspaceMemberContract
>
