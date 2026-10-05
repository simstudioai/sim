import { z } from 'zod'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'

export const createProjectInputSchema = z.object({
  organizationId: organizationIdSchema.nullable(),
  name: z.string().trim().min(1).max(100),
  initialEnvironment: z.object({ name: z.string().trim().min(1).max(100) }),
})
export type CreateProjectInput = z.output<typeof createProjectInputSchema>
