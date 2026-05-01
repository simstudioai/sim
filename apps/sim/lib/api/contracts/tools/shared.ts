import { z } from 'zod'

export const genericToolResponseSchema = z
  .object({
    success: z.boolean().optional(),
    output: z.unknown().optional(),
    error: z.string().optional(),
    details: z.array(z.unknown()).optional(),
  })
  .passthrough()
