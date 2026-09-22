import { z } from 'zod'
import {
  noInputSchema,
  workflowIdSchema,
  workspaceFileIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'
import {
  fileWorkflowIdsSchema,
  fileWorkflowSnapshotSchema,
} from '@/lib/workspace-files/workflows/types'

const fileParams = z.object({ fileId: workspaceFileIdSchema.describe('HTML file identifier.') })
const workflowParams = fileParams.extend({
  workflowId: workflowIdSchema.describe('Workflow ID configured in the file metadata.'),
})
const workspaceQuery = z
  .object({ workspaceId: workspaceIdSchema.describe('Workspace that owns the file.') })
  .strict()
export const v2FileWorkflowMetadataSchema = z.object({ workflowIds: fileWorkflowIdsSchema }).meta({
  id: 'V2FileWorkflowMetadata',
  title: 'File workflow metadata',
  description: 'Saved workflows that an HTML file may call.',
})
export const v2FileWorkflowSnapshotSchema = fileWorkflowSnapshotSchema.meta({
  id: 'V2FileWorkflowSnapshot',
  title: 'File workflow result',
  description: 'Execution status and cached output for the authorized caller.',
})
export const v2UpdateFileMetadataContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/files/[fileId]/metadata',
  params: fileParams,
  query: noInputSchema,
  body: workspaceQuery
    .extend({
      workflowIds: fileWorkflowIdsSchema.describe(
        'Replace the workflows this HTML file may call. Send an empty array to remove all dependencies. Sharing exposes these calls to the file audience.'
      ),
    })
    .strict(),
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FileWorkflowMetadataSchema),
  },
})
export const v2ReadFileWorkflowContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/files/[fileId]/workflows/[workflowId]',
  params: workflowParams,
  query: workspaceQuery,
  response: { mode: 'json', schema: v2DataResponse(v2FileWorkflowSnapshotSchema) },
})
export const v2RunFileWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files/[fileId]/workflows/[workflowId]',
  params: workflowParams,
  query: noInputSchema,
  body: workspaceQuery,
  response: { mode: 'json', schema: v2DataResponse(v2FileWorkflowSnapshotSchema) },
})
export type V2FileWorkflowMetadata = z.output<typeof v2FileWorkflowMetadataSchema>
export type V2FileWorkflowSnapshot = z.output<typeof v2FileWorkflowSnapshotSchema>
export type V2UpdateFileMetadataBody = z.input<typeof v2UpdateFileMetadataContract.body>
export type V2RunFileWorkflowBody = z.input<typeof v2RunFileWorkflowContract.body>
export type V2ReadFileWorkflowQuery = z.input<typeof v2ReadFileWorkflowContract.query>
