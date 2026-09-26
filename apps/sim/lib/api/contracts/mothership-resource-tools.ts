import { z } from 'zod'

/** Canonical resources in one selected workspace; titles come from authorized reads. */
export const openResourceInputSchema = z.strictObject({
  workspaceId: z
    .string()
    .min(1)
    .optional()
    .describe('Explicit owning workspace in organization chat.'),
  resources: z
    .array(
      z.strictObject({
        type: z.enum(['workflow', 'table', 'knowledgebase', 'file', 'log']),
        id: z.string().trim().min(1),
        viewId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe('Saved table view; table resources only.'),
      })
    )
    .min(1)
    .max(20),
})
export const openResourceOutputSchema = z.object({
  resources: z.array(
    z.object({
      type: z.enum(['workflow', 'table', 'knowledgebase', 'file', 'log']),
      id: z.string(),
      title: z.string(),
      workspaceId: z.string(),
      viewId: z.string().optional(),
      executionId: z.string().optional(),
    })
  ),
})
export type OpenResourceInput = z.infer<typeof openResourceInputSchema>
export type OpenResourceOutput = z.infer<typeof openResourceOutputSchema>
