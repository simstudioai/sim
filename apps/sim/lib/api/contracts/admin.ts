import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { workflowStateSchema } from '@/lib/api/contracts/workflows'
import { workspacePermissionSchema } from '@/lib/api/contracts/workspaces'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 250

const lastQueryValue = (value: unknown) => (Array.isArray(value) ? value.at(-1) : value)

const queryStringSchema = z.preprocess(lastQueryValue, z.string().optional())

const adminPaginationValueSchema = (defaultValue: number, normalize: (value: number) => number) =>
  z.preprocess(lastQueryValue, z.union([z.string(), z.number()]).optional()).transform((value) => {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number.parseInt(value, 10)
          : Number.NaN

    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      return defaultValue
    }

    return normalize(parsed)
  })

const adminPaginationQuerySchema = z.object({
  limit: adminPaginationValueSchema(DEFAULT_LIMIT, (limit) =>
    limit < 1 ? DEFAULT_LIMIT : Math.min(limit, MAX_LIMIT)
  ),
  offset: adminPaginationValueSchema(0, (offset) => (offset < 0 ? 0 : offset)),
})

const adminIdParamsSchema = z.object({
  id: z.string().min(1),
})

const adminWorkflowVersionParamsSchema = z.object({
  id: z.string().min(1),
  versionId: z
    .string()
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value >= 1, {
      error: 'Invalid version number',
    }),
})

const adminWorkspaceMemberParamsSchema = z.object({
  id: z.string().min(1),
  memberId: z.string().min(1),
})

const adminExportFormatQuerySchema = z.object({
  format: z.preprocess(lastQueryValue, z.enum(['zip', 'json']).catch('zip')),
})

const adminDeleteWorkspaceMemberQuerySchema = z.object({
  userId: z.preprocess(
    lastQueryValue,
    z
      .string({ error: 'userId query parameter is required' })
      .min(1, { error: 'userId query parameter is required' })
  ),
})

const adminWorkspaceMemberBodySchema = z.object({
  userId: z.string({ error: 'userId is required' }).min(1, { error: 'userId is required' }),
  permissions: workspacePermissionSchema.refine((value) => value !== null, {
    error: 'permissions must be "admin", "write", or "read"',
  }),
})

const adminUpdateWorkspaceMemberBodySchema = z.object({
  permissions: workspacePermissionSchema.refine((value) => value !== null, {
    error: 'permissions must be "admin", "write", or "read"',
  }),
})

const adminExportWorkflowsBodySchema = z.object({
  ids: z
    .array(z.string(), { error: 'ids must be a non-empty array of workflow IDs' })
    .nonempty({ error: 'ids must be a non-empty array of workflow IDs' }),
})

const adminWorkflowImportBodySchema = z.object({
  workspaceId: z
    .string({ error: 'workspaceId is required' })
    .min(1, { error: 'workspaceId is required' }),
  folderId: z.string().optional(),
  name: z.string().optional(),
  workflow: z.union([
    z.string({ error: 'workflow is required' }).min(1, { error: 'workflow is required' }),
    z.record(z.string(), z.unknown()),
  ]),
})

const adminWorkspaceImportQuerySchema = z.object({
  createFolders: z
    .preprocess(lastQueryValue, z.enum(['true', 'false']).catch('true'))
    .transform((value) => value !== 'false'),
  rootFolderName: queryStringSchema,
})

const adminWorkspaceImportBodySchema = z.object({
  workflows: z.array(
    z.object({
      content: z.union([z.string(), z.record(z.string(), z.unknown())]),
      name: z.string().optional(),
      folderPath: z.array(z.string()).optional(),
    }),
    { error: 'Invalid JSON body. Expected { workflows: [...] }' }
  ),
})

const adminPaginationMetaSchema = z.object({
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
})

const adminWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const adminWorkspaceDetailSchema = adminWorkspaceSchema.extend({
  workflowCount: z.number(),
  folderCount: z.number(),
})

const adminFolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  color: z.string().nullable(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const adminWorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  color: z.string(),
  workspaceId: z.string().nullable(),
  folderId: z.string().nullable(),
  isDeployed: z.boolean(),
  deployedAt: z.string().nullable(),
  runCount: z.number(),
  lastRunAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const adminWorkflowDetailSchema = adminWorkflowSchema.extend({
  blockCount: z.number(),
  edgeCount: z.number(),
})

const adminWorkspaceMemberSchema = z.object({
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

const adminWorkflowVariableSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'plain']),
  value: z.unknown(),
})

const adminWorkflowExportStateSchema = workflowStateSchema.extend({
  metadata: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      color: z.string().optional(),
      exportedAt: z.string().optional(),
    })
    .optional(),
  variables: z.record(z.string(), adminWorkflowVariableSchema).optional(),
})

const adminWorkflowExportPayloadSchema = z.object({
  version: z.literal('1.0'),
  exportedAt: z.string(),
  workflow: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    color: z.string(),
    workspaceId: z.string().nullable(),
    folderId: z.string().nullable(),
  }),
  state: adminWorkflowExportStateSchema,
})

const adminFolderExportPayloadSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
})

const adminWorkspaceExportPayloadSchema = z.object({
  version: z.literal('1.0'),
  exportedAt: z.string(),
  workspace: z.object({
    id: z.string(),
    name: z.string(),
  }),
  workflows: z.array(
    z.object({
      workflow: adminWorkflowExportPayloadSchema.shape.workflow,
      state: adminWorkflowExportStateSchema,
    })
  ),
  folders: z.array(adminFolderExportPayloadSchema),
})

const adminFolderFullExportPayloadSchema = z.object({
  version: z.literal('1.0'),
  exportedAt: z.string(),
  folder: z.object({
    id: z.string(),
    name: z.string(),
  }),
  workflows: z.array(
    z.object({
      workflow: adminWorkflowExportPayloadSchema.shape.workflow.omit({ workspaceId: true }),
      state: adminWorkflowExportStateSchema,
    })
  ),
  folders: z.array(adminFolderExportPayloadSchema),
})

const adminImportResultSchema = z.object({
  workflowId: z.string(),
  name: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
})

const adminWorkflowImportResponseSchema = z.object({
  workflowId: z.string(),
  name: z.string(),
  success: z.literal(true),
})

const adminWorkspaceImportResponseSchema = z.object({
  imported: z.number(),
  failed: z.number(),
  results: z.array(adminImportResultSchema),
})

const adminDeploymentVersionSchema = z.object({
  id: z.string(),
  version: z.number(),
  name: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string().nullable(),
  deployedByName: z.string().nullable(),
})

const adminDeployResultSchema = z.object({
  isDeployed: z.literal(true),
  version: z.number(),
  deployedAt: z.string(),
  warnings: z.array(z.string()).optional(),
})

const adminUndeployResultSchema = z.object({
  isDeployed: z.literal(false),
})

const adminSingleResponseSchema = <TSchema extends z.ZodType>(schema: TSchema) =>
  z.object({ data: schema })

const adminListResponseSchema = <TSchema extends z.ZodType>(schema: TSchema) =>
  z.object({
    data: z.array(schema),
    pagination: adminPaginationMetaSchema,
  })

const adminListWorkflowsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workflows',
  query: adminPaginationQuerySchema,
  response: {
    mode: 'json',
    schema: adminListResponseSchema(adminWorkflowSchema),
  },
})

const adminGetWorkflowContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workflows/[id]',
  params: adminIdParamsSchema,
  response: {
    mode: 'json',
    schema: adminSingleResponseSchema(adminWorkflowDetailSchema),
  },
})

const adminDeleteWorkflowContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/admin/workflows/[id]',
  params: adminIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      workflowId: z.string(),
    }),
  },
})

const adminDeployWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/workflows/[id]/deploy',
  params: adminIdParamsSchema,
  response: {
    mode: 'json',
    schema: adminSingleResponseSchema(adminDeployResultSchema),
  },
})

const adminUndeployWorkflowContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/admin/workflows/[id]/deploy',
  params: adminIdParamsSchema,
  response: {
    mode: 'json',
    schema: adminSingleResponseSchema(adminUndeployResultSchema),
  },
})

const adminListWorkflowVersionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workflows/[id]/versions',
  params: adminIdParamsSchema,
  response: {
    mode: 'json',
    schema: adminSingleResponseSchema(
      z.object({
        versions: z.array(adminDeploymentVersionSchema),
      })
    ),
  },
})

const adminActivateWorkflowVersionContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/workflows/[id]/versions/[versionId]/activate',
  params: adminWorkflowVersionParamsSchema,
  response: {
    mode: 'json',
    schema: adminSingleResponseSchema(
      z.object({
        success: z.literal(true),
        version: z.number(),
        deployedAt: z.string(),
        warnings: z.array(z.string()).optional(),
      })
    ),
  },
})

const adminExportWorkflowContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workflows/[id]/export',
  params: adminIdParamsSchema,
  response: {
    mode: 'json',
    schema: adminSingleResponseSchema(adminWorkflowExportPayloadSchema),
  },
})

const adminExportWorkflowsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/workflows/export',
  query: adminExportFormatQuerySchema,
  body: adminExportWorkflowsBodySchema,
  response: {
    mode: 'binary',
  },
})

const adminImportWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/workflows/import',
  body: adminWorkflowImportBodySchema,
  response: {
    mode: 'json',
    schema: adminWorkflowImportResponseSchema,
  },
})

const adminListWorkspacesContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workspaces',
  query: adminPaginationQuerySchema,
  response: {
    mode: 'json',
    schema: adminListResponseSchema(adminWorkspaceSchema),
  },
})

const adminGetWorkspaceContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workspaces/[id]',
  params: adminIdParamsSchema,
  response: {
    mode: 'json',
    schema: adminSingleResponseSchema(adminWorkspaceDetailSchema),
  },
})

const adminListWorkspaceWorkflowsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workspaces/[id]/workflows',
  params: adminIdParamsSchema,
  query: adminPaginationQuerySchema,
  response: {
    mode: 'json',
    schema: adminListResponseSchema(adminWorkflowSchema),
  },
})

const adminDeleteWorkspaceWorkflowsContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/admin/workspaces/[id]/workflows',
  params: adminIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      deleted: z.number(),
    }),
  },
})

const adminListWorkspaceFoldersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workspaces/[id]/folders',
  params: adminIdParamsSchema,
  query: adminPaginationQuerySchema,
  response: {
    mode: 'json',
    schema: adminListResponseSchema(adminFolderSchema),
  },
})

const adminExportWorkspaceContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workspaces/[id]/export',
  params: adminIdParamsSchema,
  query: adminExportFormatQuerySchema,
  response: {
    mode: 'binary',
  },
})

const adminImportWorkspaceContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/workspaces/[id]/import',
  params: adminIdParamsSchema,
  query: adminWorkspaceImportQuerySchema,
  response: {
    mode: 'json',
    schema: adminWorkspaceImportResponseSchema,
  },
})

const adminListWorkspaceMembersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workspaces/[id]/members',
  params: adminIdParamsSchema,
  query: adminPaginationQuerySchema,
  response: {
    mode: 'json',
    schema: adminListResponseSchema(adminWorkspaceMemberSchema),
  },
})

const adminCreateWorkspaceMemberContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/workspaces/[id]/members',
  params: adminIdParamsSchema,
  body: adminWorkspaceMemberBodySchema,
  response: {
    mode: 'json',
    schema: adminSingleResponseSchema(
      adminWorkspaceMemberSchema.extend({
        action: z.enum(['created', 'updated', 'already_member']),
      })
    ),
  },
})

const adminDeleteWorkspaceMemberContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/admin/workspaces/[id]/members',
  params: adminIdParamsSchema,
  query: adminDeleteWorkspaceMemberQuerySchema,
  response: {
    mode: 'json',
    schema: adminSingleResponseSchema(
      z.object({
        removed: z.literal(true),
        userId: z.string(),
        workspaceId: z.string(),
      })
    ),
  },
})

const adminGetWorkspaceMemberContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workspaces/[id]/members/[memberId]',
  params: adminWorkspaceMemberParamsSchema,
  response: {
    mode: 'json',
    schema: adminSingleResponseSchema(adminWorkspaceMemberSchema),
  },
})

const adminUpdateWorkspaceMemberContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v1/admin/workspaces/[id]/members/[memberId]',
  params: adminWorkspaceMemberParamsSchema,
  body: adminUpdateWorkspaceMemberBodySchema,
  response: {
    mode: 'json',
    schema: adminSingleResponseSchema(adminWorkspaceMemberSchema),
  },
})

const adminRemoveWorkspaceMemberContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/admin/workspaces/[id]/members/[memberId]',
  params: adminWorkspaceMemberParamsSchema,
  response: {
    mode: 'json',
    schema: adminSingleResponseSchema(
      z.object({
        removed: z.literal(true),
        memberId: z.string(),
        userId: z.string(),
        workspaceId: z.string(),
      })
    ),
  },
})

const adminExportFolderContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/folders/[id]/export',
  params: adminIdParamsSchema,
  query: adminExportFormatQuerySchema,
  response: {
    mode: 'binary',
  },
})
