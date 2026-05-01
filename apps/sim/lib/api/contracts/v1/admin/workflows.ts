import { z } from 'zod'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import {
  adminV1ExportFormatQuerySchema,
  adminV1IdParamsSchema,
  adminV1ListResponseSchema,
  adminV1PaginationQuerySchema,
  adminV1SingleResponseSchema,
} from '@/lib/api/contracts/v1/admin/shared'
import { workflowStateSchema } from '@/lib/api/contracts/workflows'

export const adminV1WorkflowVersionParamsSchema = adminV1IdParamsSchema.extend({
  versionId: z
    .string()
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value >= 1, {
      error: 'Invalid version number',
    }),
})

export const adminV1WorkflowSchema = z.object({
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

export const adminV1WorkflowDetailSchema = adminV1WorkflowSchema.extend({
  blockCount: z.number(),
  edgeCount: z.number(),
})

export const adminV1WorkflowVariableSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'plain']),
  value: z.unknown(),
})

export const adminV1WorkflowExportStateSchema = workflowStateSchema.extend({
  metadata: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      color: z.string().optional(),
      exportedAt: z.string().optional(),
    })
    .optional(),
  variables: z.record(z.string(), adminV1WorkflowVariableSchema).optional(),
})

export const adminV1WorkflowExportPayloadSchema = z.object({
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
  state: adminV1WorkflowExportStateSchema,
})

export const adminV1FolderExportPayloadSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
})

export const adminV1WorkspaceExportPayloadSchema = z.object({
  version: z.literal('1.0'),
  exportedAt: z.string(),
  workspace: z.object({
    id: z.string(),
    name: z.string(),
  }),
  workflows: z.array(
    z.object({
      workflow: adminV1WorkflowExportPayloadSchema.shape.workflow,
      state: adminV1WorkflowExportStateSchema,
    })
  ),
  folders: z.array(adminV1FolderExportPayloadSchema),
})

export const adminV1FolderFullExportPayloadSchema = z.object({
  version: z.literal('1.0'),
  exportedAt: z.string(),
  folder: z.object({
    id: z.string(),
    name: z.string(),
  }),
  workflows: z.array(
    z.object({
      workflow: adminV1WorkflowExportPayloadSchema.shape.workflow.omit({ workspaceId: true }),
      state: adminV1WorkflowExportStateSchema,
    })
  ),
  folders: z.array(adminV1FolderExportPayloadSchema),
})

export const adminV1ImportResultSchema = z.object({
  workflowId: z.string(),
  name: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
})

export const adminV1WorkflowImportResponseSchema = z.object({
  workflowId: z.string(),
  name: z.string(),
  success: z.literal(true),
})

export const adminV1DeploymentVersionSchema = z.object({
  id: z.string(),
  version: z.number(),
  name: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string().nullable(),
  deployedByName: z.string().nullable(),
})

export const adminV1DeployResultSchema = z.object({
  isDeployed: z.literal(true),
  version: z.number(),
  deployedAt: z.string(),
  warnings: z.array(z.string()).optional(),
})

export const adminV1UndeployResultSchema = z.object({
  isDeployed: z.literal(false),
})

export const adminV1ExportWorkflowsBodySchema = z.object({
  ids: z
    .array(z.string(), { error: 'ids must be a non-empty array of workflow IDs' })
    .nonempty({ error: 'ids must be a non-empty array of workflow IDs' }),
})

export const adminV1WorkflowImportBodySchema = z.object({
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

const adminV1DeleteWorkflowResultSchema = z.object({
  success: z.literal(true),
  workflowId: z.string(),
})

const adminV1WorkflowVersionsResultSchema = z.object({
  versions: z.array(adminV1DeploymentVersionSchema),
})

const adminV1ActivateWorkflowVersionResultSchema = z.object({
  success: z.literal(true),
  version: z.number(),
  deployedAt: z.string(),
  warnings: z.array(z.string()).optional(),
})

export const adminV1ListWorkflowsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workflows',
  query: adminV1PaginationQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1ListResponseSchema(adminV1WorkflowSchema),
  },
})

export const adminV1GetWorkflowContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workflows/[id]',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1WorkflowDetailSchema),
  },
})

export const adminV1DeleteWorkflowContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/admin/workflows/[id]',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1DeleteWorkflowResultSchema,
  },
})

export const adminV1DeployWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/workflows/[id]/deploy',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1DeployResultSchema),
  },
})

export const adminV1UndeployWorkflowContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/admin/workflows/[id]/deploy',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1UndeployResultSchema),
  },
})

export const adminV1ListWorkflowVersionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workflows/[id]/versions',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1WorkflowVersionsResultSchema),
  },
})

export const adminV1ActivateWorkflowVersionContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/workflows/[id]/versions/[versionId]/activate',
  params: adminV1WorkflowVersionParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1ActivateWorkflowVersionResultSchema),
  },
})

export const adminV1ExportWorkflowContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/workflows/[id]/export',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1WorkflowExportPayloadSchema),
  },
})

export const adminV1ExportWorkflowsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/workflows/export',
  query: adminV1ExportFormatQuerySchema,
  body: adminV1ExportWorkflowsBodySchema,
  response: {
    mode: 'binary',
  },
})

export const adminV1ImportWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/workflows/import',
  body: adminV1WorkflowImportBodySchema,
  response: {
    mode: 'json',
    schema: adminV1WorkflowImportResponseSchema,
  },
})

export type AdminV1WorkflowVersionParamsInput = z.input<typeof adminV1WorkflowVersionParamsSchema>
export type AdminV1WorkflowVersionParams = z.output<typeof adminV1WorkflowVersionParamsSchema>
export type AdminV1ExportWorkflowsBodyInput = z.input<typeof adminV1ExportWorkflowsBodySchema>
export type AdminV1ExportWorkflowsBody = z.output<typeof adminV1ExportWorkflowsBodySchema>
export type AdminV1WorkflowImportBodyInput = z.input<typeof adminV1WorkflowImportBodySchema>
export type AdminV1WorkflowImportBody = z.output<typeof adminV1WorkflowImportBodySchema>
export type AdminV1Workflow = z.output<typeof adminV1WorkflowSchema>
export type AdminV1WorkflowDetail = z.output<typeof adminV1WorkflowDetailSchema>
export type AdminV1WorkflowVariable = z.output<typeof adminV1WorkflowVariableSchema>
export type AdminV1WorkflowExportState = z.output<typeof adminV1WorkflowExportStateSchema>
export type AdminV1WorkflowExportPayload = z.output<typeof adminV1WorkflowExportPayloadSchema>
export type AdminV1FolderExportPayload = z.output<typeof adminV1FolderExportPayloadSchema>
export type AdminV1WorkspaceExportPayload = z.output<typeof adminV1WorkspaceExportPayloadSchema>
export type AdminV1FolderFullExportPayload = z.output<typeof adminV1FolderFullExportPayloadSchema>
export type AdminV1ImportResult = z.output<typeof adminV1ImportResultSchema>
export type AdminV1WorkflowImportResponseBody = z.output<typeof adminV1WorkflowImportResponseSchema>
export type AdminV1DeploymentVersion = z.output<typeof adminV1DeploymentVersionSchema>
export type AdminV1DeployResult = z.output<typeof adminV1DeployResultSchema>
export type AdminV1UndeployResult = z.output<typeof adminV1UndeployResultSchema>
export type AdminV1ListWorkflowsResponse = ContractJsonResponse<typeof adminV1ListWorkflowsContract>
export type AdminV1GetWorkflowResponse = ContractJsonResponse<typeof adminV1GetWorkflowContract>
export type AdminV1DeleteWorkflowResponse = ContractJsonResponse<
  typeof adminV1DeleteWorkflowContract
>
export type AdminV1DeployWorkflowResponse = ContractJsonResponse<
  typeof adminV1DeployWorkflowContract
>
export type AdminV1UndeployWorkflowResponse = ContractJsonResponse<
  typeof adminV1UndeployWorkflowContract
>
export type AdminV1ListWorkflowVersionsResponse = ContractJsonResponse<
  typeof adminV1ListWorkflowVersionsContract
>
export type AdminV1ActivateWorkflowVersionResponse = ContractJsonResponse<
  typeof adminV1ActivateWorkflowVersionContract
>
export type AdminV1ExportWorkflowResponse = ContractJsonResponse<
  typeof adminV1ExportWorkflowContract
>
export type AdminV1ImportWorkflowResponse = ContractJsonResponse<
  typeof adminV1ImportWorkflowContract
>
