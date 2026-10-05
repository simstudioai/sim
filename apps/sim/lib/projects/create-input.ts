import { z } from 'zod'

export const createProjectInputSchema = z.object({
  organizationId: z.string().trim().min(1).nullable(),
  name: z.string().trim().min(1).max(100),
  initialEnvironment: z.object({ name: z.string().trim().min(1).max(100) }),
})
export type CreateProjectInput = z.output<typeof createProjectInputSchema>
