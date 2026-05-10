import { z } from 'zod'

export const adminV1DefaultLimit = 50
export const adminV1MaxLimit = 250

export const lastQueryValue = (value: unknown) => (Array.isArray(value) ? value.at(-1) : value)

export const adminV1IdParamsSchema = z.object({
  id: z.string().min(1),
})

export const adminV1PaginationQuerySchema = z.object({
  limit: z
    .preprocess((value) => {
      const queryValue = lastQueryValue(value)
      return typeof queryValue === 'string' ? Number.parseInt(queryValue, 10) : queryValue
    }, z.number().int().catch(adminV1DefaultLimit))
    .catch(adminV1DefaultLimit)
    .transform((limit) => {
      if (limit < 1) return adminV1DefaultLimit
      return Math.min(limit, adminV1MaxLimit)
    }),
  offset: z
    .preprocess((value) => {
      const queryValue = lastQueryValue(value)
      return typeof queryValue === 'string' ? Number.parseInt(queryValue, 10) : queryValue
    }, z.number().int().catch(0))
    .catch(0)
    .transform((offset) => {
      if (offset < 0) return 0
      return offset
    }),
})

export const adminV1BooleanQuerySchema = z
  .preprocess(lastQueryValue, z.enum(['true', 'false']).optional().catch(undefined))
  .transform((value) => value === 'true')

export const adminV1ExportFormatQuerySchema = z.object({
  format: z.preprocess(lastQueryValue, z.enum(['zip', 'json']).catch('zip')),
})

export const adminV1QueryStringSchema = z.preprocess(lastQueryValue, z.string().optional())

export const adminV1FutureIsoDateSchema = z
  .string({ error: 'expiresAt must be a valid ISO 8601 date string' })
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    error: 'expiresAt must be a valid ISO 8601 date string',
  })
  .refine((value) => new Date(value).getTime() > Date.now(), {
    error: 'expiresAt must be in the future',
  })

export const adminV1PaginationMetaSchema = z.object({
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
})

export const adminV1ListResponseSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    pagination: adminV1PaginationMetaSchema,
  })

export const adminV1SingleResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    data: dataSchema,
  })

export const adminV1SubscriptionSchema = z.object({
  id: z.string(),
  plan: z.string(),
  referenceId: z.string(),
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  status: z.string().nullable(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean().nullable(),
  seats: z.number().nullable(),
  trialStart: z.string().nullable(),
  trialEnd: z.string().nullable(),
  metadata: z.unknown(),
})

export type AdminV1IdParamsInput = z.input<typeof adminV1IdParamsSchema>
export type AdminV1IdParams = z.output<typeof adminV1IdParamsSchema>
export type AdminV1PaginationQueryInput = z.input<typeof adminV1PaginationQuerySchema>
export type AdminV1PaginationQuery = z.output<typeof adminV1PaginationQuerySchema>
export type AdminV1ExportFormatQueryInput = z.input<typeof adminV1ExportFormatQuerySchema>
export type AdminV1ExportFormatQuery = z.output<typeof adminV1ExportFormatQuerySchema>
