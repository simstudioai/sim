import { z } from 'zod'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import { lastQueryValue } from '@/lib/api/contracts/v1/admin/shared'

export const adminV1GlobalWorkQuerySchema = z.object({
  month: z
    .preprocess(
      lastQueryValue,
      z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .optional()
    )
    .optional(),
})

export const adminV1GlobalWorkResponseSchema = z.object({
  data: z.object({
    month: z.string(),
    label: z.string(),
    isCurrentMonth: z.boolean(),
    attribution: z.literal('estimated'),
    formula: z.object({
      minutesPerUnit: z.number().positive(),
      globalAnnualHours: z.number().positive(),
    }),
    units: z.number().int().nonnegative(),
    humanEquivalentHours: z.number().nonnegative(),
    annualizedPercentGlobalWork: z.number().nonnegative(),
    sources: z.array(
      z.object({
        source: z.enum(['workflow', 'mothership']),
        units: z.number().int().nonnegative(),
        humanEquivalentHours: z.number().nonnegative(),
      })
    ),
    daily: z.array(
      z.object({
        date: z.string(),
        units: z.number().int().nonnegative(),
        workflow: z.number().int().nonnegative(),
        mothership: z.number().int().nonnegative(),
      })
    ),
  }),
})

export const adminV1GetGlobalWorkContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/dashboard/global-work',
  query: adminV1GlobalWorkQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1GlobalWorkResponseSchema,
  },
})

export type AdminV1GetGlobalWorkResponse = ContractJsonResponse<typeof adminV1GetGlobalWorkContract>
