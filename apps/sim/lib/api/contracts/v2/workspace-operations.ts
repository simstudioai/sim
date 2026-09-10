import { z } from 'zod'
import { noInputSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2PaginationFields,
} from '@/lib/api/contracts/v2/shared'
import { forkTriggerUrlChangeSchema } from '@/lib/api/contracts/workspace-fork'

export const v2OperationIssueSchema = z.object({
  code: z.string().min(1).max(128).describe('Stable machine-readable issue code.'),
  message: z.string().max(2048).describe('Human-readable explanation of the issue.'),
  workflowId: z
    .string()
    .max(256)
    .optional()
    .describe('Workflow affected by this issue or deployment attempt.'),
  blockId: z
    .string()
    .max(256)
    .optional()
    .describe('Source block identifier before graph ID regeneration.'),
  subBlockKey: z
    .string()
    .max(256)
    .optional()
    .describe('Registered source field key, including the tool index for nested Agent fields.'),
})
export const v2OperationReportSchema = z
  .object({
    operationId: z
      .string()
      .min(1)
      .max(256)
      .describe('Durable operation identifier to use for polling.'),
    requestId: z
      .string()
      .min(1)
      .max(128)
      .describe('Stable client request ID for reconciliation and identical retries.'),
    workspaceId: workspaceIdSchema.describe('Explicit current workspace scope.'),
    kind: z
      .enum(['workflow_import', 'workspace_fork', 'workspace_push', 'workspace_pull'])
      .describe('Resource or operation kind.'),
    applied: z
      .literal(true)
      .describe('The business transaction committed, including when follow-up work fails.'),
    status: z
      .enum([
        'processing',
        'completed',
        'completed_with_warnings',
        'requires_configuration',
        'failed',
      ])
      .describe('Current operation or deployment outcome.'),
    resourceIds: z
      .array(z.string().min(1).max(256))
      .max(5000)
      .describe('Identifiers of resources created or changed by the committed operation.'),
    issues: z
      .array(v2OperationIssueSchema)
      .max(2000)
      .describe('Structured warnings, missing configuration, and follow-up failures.'),
    idMap: z
      .record(z.string().max(256), z.string().max(256))
      .optional()
      .describe('Source graph identifiers mapped to the imported identifiers.'),
    deploymentOperationIds: z
      .array(z.string().max(256))
      .max(1000)
      .optional()
      .describe('Exact deployment attempts admitted by the workspace operation.'),
    deployments: z
      .array(
        z.object({
          operationId: z
            .string()
            .max(256)
            .describe('Durable operation identifier to use for polling.'),
          workflowId: z
            .string()
            .max(256)
            .describe('Workflow affected by this issue or deployment attempt.'),
          version: z
            .number()
            .int()
            .min(1)
            .describe('Reference format or deployment version number.'),
          status: z
            .enum(['preparing', 'activating', 'active', 'failed', 'superseded'])
            .describe('Current operation or deployment outcome.'),
          ready: z
            .boolean()
            .describe(
              'Whether the operation passes its current apply or deployment readiness checks.'
            ),
          pendingComponents: z
            .array(z.string().max(128))
            .max(32)
            .describe('Deployment components that have not finished becoming ready.'),
        })
      )
      .max(1000)
      .optional()
      .describe('Readiness of the exact admitted deployment attempts.'),
    triggerUrlChanges: z
      .array(forkTriggerUrlChangeSchema)
      .max(1000)
      .optional()
      .describe('Public trigger paths changed by this sync, with the affected workflow names.'),
    backgroundWorkId: z
      .string()
      .max(256)
      .optional()
      .describe('Workspace activity identifier for resource-copy progress.'),
    copyProgress: z
      .object({
        status: z
          .enum(['pending', 'completed', 'failed'])
          .describe('Current operation or deployment outcome.'),
        copied: z.number().int().min(0).describe('Number of resources copied successfully.'),
        failed: z.number().int().min(0).describe('Number of resources that failed to copy.'),
      })
      .optional()
      .describe('Completion status and counts for explicitly selected resource copies.'),
  })
  .meta({
    id: 'WorkspaceOperationReport',
    title: 'WorkspaceOperationReport',
    description: 'The WorkspaceOperationReport result.',
  })
export const v2WorkspaceOperationParamsSchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Explicit current workspace scope.'),
    operationId: z
      .string()
      .min(1)
      .max(256)
      .describe('Durable operation identifier to use for polling.'),
  })
  .strict()
export const v2ListWorkspaceOperationsQuerySchema = z
  .object({
    ...v2PaginationFields(),
    requestId: z
      .string()
      .min(1)
      .max(128)
      .optional()
      .describe('Find an uncertain mutation by its original request ID.')
      .describe('Stable client request ID for reconciliation and identical retries.'),
  })
  .strict()
export const v2GetWorkspaceOperationContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workspaces/[workspaceId]/operations/[operationId]',
  params: v2WorkspaceOperationParamsSchema,
  query: noInputSchema,
  response: { mode: 'json', schema: v2DataResponse(v2OperationReportSchema) },
})
export const v2ListWorkspaceOperationsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workspaces/[workspaceId]/operations',
  params: z
    .object({ workspaceId: workspaceIdSchema.describe('Explicit current workspace scope.') })
    .strict(),
  query: v2ListWorkspaceOperationsQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2OperationReportSchema) },
})
export type V2OperationReport = z.output<typeof v2OperationReportSchema>
export type V2ListWorkspaceOperationsQuery = z.input<typeof v2ListWorkspaceOperationsQuerySchema>
export type V2WorkspaceOperationParams = z.input<typeof v2WorkspaceOperationParamsSchema>
