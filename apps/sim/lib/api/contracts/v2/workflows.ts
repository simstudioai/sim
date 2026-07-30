import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v1DeployWorkflowDataSchema,
  v1ListWorkflowsQuerySchema,
  v1RollbackWorkflowDataSchema,
} from '@/lib/api/contracts/v1/workflows'
import { v2CursorListResponse, v2DataResponse } from '@/lib/api/contracts/v2/shared'
import { workflowIdParamsSchema } from '@/lib/api/contracts/workflows'

/**
 * v2 workflows contracts. Request shapes are reused verbatim from v1 (the list
 * query and `[id]` param are unchanged); only the response envelope is upgraded
 * to the canonical v2 shapes with concrete item/detail schemas. The
 * deploy/rollback/undeploy data payloads reuse the already-concrete v1 schemas,
 * re-wrapped in `v2DataResponse` (the v1 `limits` body field is dropped — v2
 * carries rate-limit state in headers and usage on a dedicated endpoint).
 */

export const v2WorkflowListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  folderId: z.string().nullable(),
  workspaceId: z.string(),
  isDeployed: z.boolean(),
  deployedAt: z.string().nullable(),
  runCount: z.number(),
  lastRunAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type V2WorkflowListItem = z.output<typeof v2WorkflowListItemSchema>

/** A single trigger input field extracted from the workflow's input-definition block. */
const v2WorkflowInputFieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string().optional(),
})

export const v2WorkflowDetailSchema = v2WorkflowListItemSchema.extend({
  /**
   * Workflow-scoped variables keyed by variable id. Each value is a structured
   * variable object (`{ id, name, type, value, ... }`); only the inner `value`
   * is user-defined/free-form. Kept as `unknown` to tolerate legacy/unstamped
   * rows — tightening to a concrete object schema later is consumer-safe (the
   * wire already carries the full object), so it stays additively evolvable.
   */
  variables: z.record(z.string(), z.unknown()),
  inputs: z.array(v2WorkflowInputFieldSchema),
})

export type V2WorkflowDetail = z.output<typeof v2WorkflowDetailSchema>

/**
 * Undeploy returns the deployment state without a version number. Derived from
 * the exported v1 deploy data schema (its private base is not exported) so the
 * shape stays in lockstep with v1.
 */
const v2UndeployWorkflowDataSchema = v1DeployWorkflowDataSchema.omit({ version: true })

export const v2ListWorkflowsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows',
  query: v1ListWorkflowsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2WorkflowListItemSchema),
  },
})

export const v2GetWorkflowContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/[id]',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowDetailSchema),
  },
})

export const v2DeployWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/[id]/deploy',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v1DeployWorkflowDataSchema),
  },
})

export const v2UndeployWorkflowContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/workflows/[id]/deploy',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2UndeployWorkflowDataSchema),
  },
})

export const v2RollbackWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/[id]/rollback',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v1RollbackWorkflowDataSchema),
  },
})
