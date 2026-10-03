import { z } from 'zod'

export const createWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  skipDefaultWorkflow: z.boolean().optional().default(false),
})

export type CreateWorkspaceInput = z.output<typeof createWorkspaceInputSchema>
