import { z } from 'zod'
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

export const adminPaginationQuerySchema = z.object({
  limit: adminPaginationValueSchema(DEFAULT_LIMIT, (limit) =>
    limit < 1 ? DEFAULT_LIMIT : Math.min(limit, MAX_LIMIT)
  ),
  offset: adminPaginationValueSchema(0, (offset) => (offset < 0 ? 0 : offset)),
})

export const adminIdParamsSchema = z.object({
  id: z.string().min(1),
})

export const adminWorkflowVersionParamsSchema = z.object({
  id: z.string().min(1),
  versionId: z
    .string()
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value >= 1, {
      error: 'Invalid version number',
    }),
})

export const adminWorkspaceMemberParamsSchema = z.object({
  id: z.string().min(1),
  memberId: z.string().min(1),
})

export const adminExportFormatQuerySchema = z.object({
  format: z.preprocess(lastQueryValue, z.enum(['zip', 'json']).catch('zip')),
})

export const adminDeleteWorkspaceMemberQuerySchema = z.object({
  userId: z.preprocess(
    lastQueryValue,
    z
      .string({ error: 'userId query parameter is required' })
      .min(1, { error: 'userId query parameter is required' })
  ),
})

export const adminWorkspaceMemberBodySchema = z.object({
  userId: z.string({ error: 'userId is required' }).min(1, { error: 'userId is required' }),
  permissions: workspacePermissionSchema.refine((value) => value !== null, {
    error: 'permissions must be "admin", "write", or "read"',
  }),
})

export const adminUpdateWorkspaceMemberBodySchema = z.object({
  permissions: workspacePermissionSchema.refine((value) => value !== null, {
    error: 'permissions must be "admin", "write", or "read"',
  }),
})

export const adminExportWorkflowsBodySchema = z.object({
  ids: z
    .array(z.string(), { error: 'ids must be a non-empty array of workflow IDs' })
    .nonempty({ error: 'ids must be a non-empty array of workflow IDs' }),
})

export const adminWorkflowImportBodySchema = z.object({
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

export const adminWorkspaceImportQuerySchema = z.object({
  createFolders: z
    .preprocess(lastQueryValue, z.enum(['true', 'false']).catch('true'))
    .transform((value) => value !== 'false'),
  rootFolderName: queryStringSchema,
})

export const adminPaginationMetaSchema = z.object({
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
})

export const adminWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const adminWorkspaceDetailSchema = adminWorkspaceSchema.extend({
  workflowCount: z.number(),
  folderCount: z.number(),
})

export const adminFolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  color: z.string().nullable(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const adminWorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  workspaceId: z.string().nullable(),
  folderId: z.string().nullable(),
  isDeployed: z.boolean(),
  deployedAt: z.string().nullable(),
  runCount: z.number(),
  lastRunAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const adminWorkflowDetailSchema = adminWorkflowSchema.extend({
  blockCount: z.number(),
  edgeCount: z.number(),
})

export const adminWorkspaceMemberSchema = z.object({
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

export const adminWorkflowVariableSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'plain']),
  value: z.unknown(),
})

export const adminWorkflowExportStateSchema = workflowStateSchema.extend({
  metadata: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      exportedAt: z.string().optional(),
    })
    .optional(),
  variables: z.record(z.string(), adminWorkflowVariableSchema).optional(),
})

export const adminWorkflowExportPayloadSchema = z.object({
  version: z.literal('1.0'),
  exportedAt: z.string(),
  workflow: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    workspaceId: z.string().nullable(),
    folderId: z.string().nullable(),
  }),
  state: adminWorkflowExportStateSchema,
})

export const adminFolderExportPayloadSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
})

export const adminImportResultSchema = z.object({
  workflowId: z.string(),
  name: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
})

export const adminWorkflowImportResponseSchema = z.object({
  workflowId: z.string(),
  name: z.string(),
  success: z.literal(true),
})

export const adminWorkspaceImportResponseSchema = z.object({
  imported: z.number(),
  failed: z.number(),
  results: z.array(adminImportResultSchema),
})

export const adminDeploymentVersionSchema = z.object({
  id: z.string(),
  version: z.number(),
  name: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string().nullable(),
  deployedByName: z.string().nullable(),
})

export const adminDeployResultSchema = z.object({
  isDeployed: z.literal(true),
  version: z.number(),
  deployedAt: z.string(),
  warnings: z.array(z.string()).optional(),
})

export const adminUndeployResultSchema = z.object({
  isDeployed: z.literal(false),
})
