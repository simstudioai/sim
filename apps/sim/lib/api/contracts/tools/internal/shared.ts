import { z } from 'zod'

export const internalToolResponseSchema = z
  .object({
    success: z.boolean().optional(),
    output: z.unknown().optional(),
    error: z.string().optional(),
    details: z.array(z.unknown()).optional(),
  })
  .passthrough()
