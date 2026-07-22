import { z } from 'zod'
import { nonEmptyIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

/**
 * One node in a workflow reference tree. Recursive, so the Zod schema below needs
 * `z.lazy` plus this explicit interface annotation — TypeScript cannot infer a
 * self-referential type. Shared by the server graph builder (its return element
 * type) and the client hook, keeping both off `z.output<...>`.
 */
export interface ReferenceNode {
  /** Referenced workflow id. */
  id: string
  /** Referenced workflow name (falls back to the id if unresolved). */
  name: string
  /**
   * True when this node closes a cycle already on the current path (e.g. the
   * root, or `A → B → A`). Cyclic nodes carry no `children`.
   */
  cycle: boolean
  children: ReferenceNode[]
}

export const referenceNodeSchema: z.ZodType<ReferenceNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    cycle: z.boolean(),
    children: z.array(referenceNodeSchema),
  })
)

export const workflowReferencesParamsSchema = z.object({
  id: nonEmptyIdSchema,
})

export const workflowReferencesQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
})

export const workflowReferencesResponseSchema = z.object({
  /** Workflows that call this workflow (inbound), each recursively expanded. */
  callers: z.array(referenceNodeSchema),
  /** Workflows this workflow calls (outbound), each recursively expanded. */
  callees: z.array(referenceNodeSchema),
})

export type WorkflowReferencesResponse = z.output<typeof workflowReferencesResponseSchema>

export const getWorkflowReferencesContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]/references',
  params: workflowReferencesParamsSchema,
  query: workflowReferencesQuerySchema,
  response: {
    mode: 'json',
    schema: workflowReferencesResponseSchema,
  },
})
