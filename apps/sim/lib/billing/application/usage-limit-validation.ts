import { z } from 'zod'

export const usageLimitReadSchema = z.object({
  context: z.enum(['user', 'organization']).optional().default('user'),
  userId: z.string().optional(),
  organizationId: z.string().optional(),
  memberLimit: z.coerce.number().int().min(1).max(100).default(50),
  memberOffset: z.coerce.number().int().min(0).default(0),
})
export const usageLimitUpdateSchema = z
  .object({
    limit: z.number().min(0, 'Limit must be a non-negative number'),
    context: z.enum(['user', 'organization']).optional().default('user'),
    organizationId: z.string().optional(),
  })
  .refine((data) => data.context !== 'organization' || data.organizationId, {
    message: 'Organization ID is required when context is organization',
  })
export const memberCreditLimitUpdateSchema = z.object({
  creditLimit: z
    .number()
    .int('Credit limit must be a whole number of credits')
    .min(0, 'Credit limit cannot be negative')
    .nullable(),
})
export type UsageLimitReadInput = z.input<typeof usageLimitReadSchema>
export type UsageLimitUpdateInput = z.input<typeof usageLimitUpdateSchema>
