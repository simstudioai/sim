import { z } from 'zod'

export const toolFailureResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  details: z.array(z.unknown()).optional(),
})

export const toolSuccessResponseSchema = <S extends z.ZodType>(output: S) =>
  z.object({
    success: z.literal(true),
    output,
  })
