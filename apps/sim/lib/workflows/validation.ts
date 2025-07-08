import { z } from 'zod'

/**
 * Shared Zod schema for validating WorkflowState objects
 * This schema is used across API routes and other validation points
 * to ensure consistent workflow state structure validation.
 */
export const workflowStateSchema = z.object({
  // Core workflow structure
  blocks: z.record(z.any()),
  edges: z.array(z.any()),
  loops: z.record(z.any()).optional().default({}),
  parallels: z.record(z.any()).optional().default({}),

  // Timestamps
  lastSaved: z.number().optional(),
  lastUpdate: z.number().optional(),

  // Deployment fields
  isDeployed: z.boolean().optional(),
  // deployedAt can be Date, string, or undefined depending on serialization
  deployedAt: z.union([z.date(), z.string(), z.undefined()]).optional(),
  deploymentStatuses: z.record(z.any()).optional().default({}),
  needsRedeployment: z.boolean().optional(),

  // Feature flags
  hasActiveSchedule: z.boolean().optional().default(false),
  hasActiveWebhook: z.boolean().optional().default(false),
})

/**
 * Schema for validating workflow state in API requests
 * This is a more lenient version that handles serialized data
 */
export const workflowStateApiSchema = workflowStateSchema
  .extend({
    // Allow additional fields that might be present in API requests
    // but aren't part of the core WorkflowState interface
  })
  .passthrough()

/**
 * Type inference from the schema
 */
export type ValidatedWorkflowState = z.infer<typeof workflowStateSchema>
