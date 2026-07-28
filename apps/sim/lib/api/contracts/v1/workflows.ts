import { z } from 'zod'
import {
  activeDeploymentSummarySchema,
  deploymentOperationSummarySchema,
  deploymentVersionMetadataFieldsSchema,
} from '@/lib/api/contracts/deployments'
import { booleanQueryFlagSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { workflowIdParamsSchema, workflowStateSchema } from '@/lib/api/contracts/workflows'

export const v1ListWorkflowsQuerySchema = z.object({
  workspaceId: z.string().min(1),
  folderId: z.string().optional(),
  deployedOnly: booleanQueryFlagSchema.optional().default(false),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  cursor: z.string().optional(),
})

export type V1ListWorkflowsQuery = z.output<typeof v1ListWorkflowsQuerySchema>

/**
 * Generic wrapper used by v1 admin workflow list/detail responses. `data` is
 * the provider-shaped admin payload (varies per route) and `limits` is an
 * optional rate-limit envelope; both are intentionally `z.unknown()` here.
 * Tightening would require per-route discriminated unions and is tracked as
 * a follow-up.
 *
 * boundary-policy: this is the "validates nothing" alias form that the audit
 * script's `untyped-response` regex doesn't currently catch. Treat any new
 * wrapper of this shape the same way — either annotate at the contract use
 * site with `// untyped-response: <reason>` or replace with a concrete schema.
 */
const v1WorkflowApiResponseWithLimitsSchema = z
  .object({
    data: z.unknown(),
    limits: z.unknown().optional(),
  })
  .passthrough()

export const v1ListWorkflowsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/workflows',
  query: v1ListWorkflowsQuerySchema,
  response: {
    mode: 'json',
    schema: v1WorkflowApiResponseWithLimitsSchema,
  },
})

export const v1GetWorkflowContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/workflows/[id]',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v1WorkflowApiResponseWithLimitsSchema,
  },
})

/**
 * Optional version metadata accepted by the v1 deploy endpoint. Field bounds
 * are shared with the UI deployment surface via
 * {@link deploymentVersionMetadataFieldsSchema}. The route tolerates an
 * absent/empty body, so this schema is validated by the handler against
 * `parseOptionalJsonBody` instead of being attached to the contract.
 */
export const v1DeployWorkflowBodySchema = z.object({
  name: deploymentVersionMetadataFieldsSchema.shape.name,
  description: deploymentVersionMetadataFieldsSchema.shape.description,
})

export type V1DeployWorkflowBody = z.input<typeof v1DeployWorkflowBodySchema>

/** Bounded to the Postgres `integer` range of `workflow_deployment_version.version`. */
const deploymentVersionNumberSchema = z
  .number()
  .int('version must be an integer')
  .min(1, 'version must be a positive integer')
  .max(2147483647, 'version is out of range')

/**
 * Optional rollback target accepted by the v1 rollback endpoint. When
 * `version` is omitted the route rolls back to the deployment version that
 * precedes the currently active one. Validated by the handler against
 * `parseOptionalJsonBody`, so it is not attached to the contract.
 */
export const v1RollbackWorkflowBodySchema = z.object({
  version: deploymentVersionNumberSchema.optional(),
})

export type V1RollbackWorkflowBody = z.input<typeof v1RollbackWorkflowBodySchema>

const v1DeploymentStateSchema = z.object({
  id: z.string(),
  isDeployed: z.boolean(),
  deployedAt: z.string().nullable(),
  warnings: z.array(z.string()),
})

/**
 * Deploy/rollback admit asynchronously: HTTP success means the attempt was
 * accepted, while `isDeployed` reflects whether a version is actually live.
 * `latestDeploymentAttempt` carries the lifecycle status
 * (preparing/activating/active/failed/superseded) so API consumers can poll
 * to a terminal state instead of guessing from `isDeployed` alone.
 */
const v1DeploymentLifecycleSchema = v1DeploymentStateSchema.extend({
  activeDeployment: activeDeploymentSummarySchema.nullable(),
  latestDeploymentAttempt: deploymentOperationSummarySchema.nullable(),
})

export const v1DeployWorkflowDataSchema = v1DeploymentLifecycleSchema.extend({
  version: z.number().optional(),
})

export type V1DeployWorkflowData = z.output<typeof v1DeployWorkflowDataSchema>

export const v1RollbackWorkflowDataSchema = v1DeploymentLifecycleSchema.extend({
  version: z.number(),
})

export type V1RollbackWorkflowData = z.output<typeof v1RollbackWorkflowDataSchema>

export type V1UndeployWorkflowData = z.output<typeof v1DeploymentStateSchema>

const withV1Limits = <T extends z.ZodType>(data: T) =>
  z.object({
    data,
    limits: z.unknown().optional(),
  })

export const v1DeployWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/workflows/[id]/deploy',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: withV1Limits(v1DeployWorkflowDataSchema),
  },
})

export const v1UndeployWorkflowContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/workflows/[id]/deploy',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: withV1Limits(v1DeploymentStateSchema),
  },
})

export const v1RollbackWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/workflows/[id]/rollback',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: withV1Limits(v1RollbackWorkflowDataSchema),
  },
})

/** Workflow variable as carried inside an export payload's `state.variables`. */
const v1WorkflowExportVariableSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'plain']),
  value: z.unknown(),
})

/**
 * Workflow state emitted by the public export endpoint.
 *
 * Structurally mirrors the admin export state (`adminWorkflowExportStateSchema`
 * in `@/lib/api/contracts/admin`) so both payloads round-trip through the same
 * importer. The surfaces are deliberately kept as separate schemas because the
 * data differs: public exports are secret-sanitized via `sanitizeForExport`
 * (credentials stripped, `{{ENV_VAR}}` references preserved), while admin
 * exports are raw for backup/restore.
 */
export const v1WorkflowExportStateSchema = workflowStateSchema.extend({
  metadata: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      sortOrder: z.number().optional(),
      exportedAt: z.string().optional(),
    })
    .optional(),
  variables: z.record(z.string(), v1WorkflowExportVariableSchema).optional(),
})

export const v1WorkflowExportPayloadSchema = z.object({
  version: z.literal('1.0'),
  exportedAt: z.string(),
  workflow: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    workspaceId: z.string().nullable(),
    folderId: z.string().nullable(),
  }),
  state: v1WorkflowExportStateSchema,
})

export type V1WorkflowExportPayload = z.output<typeof v1WorkflowExportPayloadSchema>

export const v1ExportWorkflowContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/workflows/[id]/export',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: withV1Limits(v1WorkflowExportPayloadSchema),
  },
})

/**
 * Upper bound on an imported workflow name, matching the `workflow.name`
 * column and the deduplication suffix headroom applied on insert.
 */
const V1_IMPORT_NAME_MAX_LENGTH = 200

/** Upper bound on an imported workflow description. */
const V1_IMPORT_DESCRIPTION_MAX_LENGTH = 2000

/**
 * Import request body. `workflow` accepts either the envelope emitted by
 * {@link v1ExportWorkflowContract} (`{ version, exportedAt, workflow, state }`),
 * a bare workflow state (`{ blocks, edges, ... }`), or a JSON string of either
 * — the same three forms the admin importer accepts, so payloads are portable
 * between the two surfaces. `name` and `description` override whatever the
 * payload's own metadata carries.
 */
export const v1ImportWorkflowBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  folderId: z.string().min(1, 'folderId cannot be empty').optional(),
  name: z
    .string()
    .min(1, 'name cannot be empty')
    .max(V1_IMPORT_NAME_MAX_LENGTH, `name must be at most ${V1_IMPORT_NAME_MAX_LENGTH} characters`)
    .optional(),
  description: z
    .string()
    .max(
      V1_IMPORT_DESCRIPTION_MAX_LENGTH,
      `description must be at most ${V1_IMPORT_DESCRIPTION_MAX_LENGTH} characters`
    )
    .optional(),
  workflow: z.union(
    [
      z.string().min(1, 'workflow cannot be empty'),
      z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, {
        error: 'workflow cannot be empty',
      }),
    ],
    { error: 'workflow must be a workflow export object or a JSON string' }
  ),
})

export type V1ImportWorkflowBody = z.input<typeof v1ImportWorkflowBodySchema>

/**
 * Created workflow, shaped as the subset of the v1 workflow resource that is
 * knowable at import time (an imported workflow is never deployed and has no
 * run history), so callers can feed it straight back into
 * `GET /api/v1/workflows/{id}`.
 */
export const v1ImportWorkflowDataSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  workspaceId: z.string(),
  folderId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type V1ImportWorkflowData = z.output<typeof v1ImportWorkflowDataSchema>

export const v1ImportWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/workflows/import',
  body: v1ImportWorkflowBodySchema,
  response: {
    mode: 'json',
    schema: withV1Limits(v1ImportWorkflowDataSchema),
  },
})
