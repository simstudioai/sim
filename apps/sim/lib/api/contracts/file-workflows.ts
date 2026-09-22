import { z } from 'zod'
import {
  workflowIdSchema,
  workspaceFileIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  fileWorkflowIdsSchema,
  fileWorkflowSnapshotSchema,
} from '@/lib/workspace-files/workflows/types'

export type FileWorkflowSnapshot = z.output<typeof fileWorkflowSnapshotSchema>
export const updateFileWorkflowMetadataBodySchema = z
  .object({ workflowIds: fileWorkflowIdsSchema })
  .strict()
export type UpdateFileWorkflowMetadataBody = z.input<typeof updateFileWorkflowMetadataBodySchema>
export const fileWorkflowParamsSchema = z.object({
  id: workspaceIdSchema,
  fileId: workspaceFileIdSchema,
  workflowId: workflowIdSchema,
})

export const readFileWorkflowContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/files/[fileId]/workflows/[workflowId]',
  params: fileWorkflowParamsSchema,
  response: { mode: 'json', schema: fileWorkflowSnapshotSchema },
})
export const runFileWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/files/[fileId]/workflows/[workflowId]',
  params: fileWorkflowParamsSchema,
  body: z.object({}).strict(),
  response: { mode: 'json', schema: fileWorkflowSnapshotSchema },
})
export const updateFileWorkflowMetadataContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workspaces/[id]/files/[fileId]/metadata',
  params: fileWorkflowParamsSchema.omit({ workflowId: true }),
  body: updateFileWorkflowMetadataBodySchema,
  response: { mode: 'json', schema: updateFileWorkflowMetadataBodySchema },
})

export const publicFileWorkflowParamsSchema = z.object({
  token: z.string().min(1).max(128),
  workflowId: workflowIdSchema,
})
export const readPublicFileWorkflowContract = defineRouteContract({
  method: 'GET',
  path: '/api/files/public/[token]/workflows/[workflowId]',
  params: publicFileWorkflowParamsSchema,
  response: { mode: 'json', schema: fileWorkflowSnapshotSchema },
})
export const runPublicFileWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/public/[token]/workflows/[workflowId]',
  params: publicFileWorkflowParamsSchema,
  body: z.object({}).strict(),
  response: { mode: 'json', schema: fileWorkflowSnapshotSchema },
})

export const getHtmlRuntimeContract = defineRouteContract({
  method: 'GET',
  path: '/api/files/html-runtime',
  response: { mode: 'json', schema: z.object({ frameUrl: z.url() }) },
})
