import { z } from 'zod'
import {
  type ContractBody,
  type ContractBodyInput,
  type ContractJsonResponse,
  type ContractQuery,
  type ContractQueryInput,
  defineRouteContract,
} from '@/lib/api/contracts/types'
import {
  adminV1FutureIsoDateSchema,
  adminV1QueryStringSchema,
  adminV1SingleResponseSchema,
  lastQueryValue,
} from '@/lib/api/contracts/v1/admin/shared'

const adminV1ReferralCampaignDurations = ['once', 'repeating', 'forever'] as const
const adminV1ReferralCampaignAppliesTo = [
  'pro',
  'team',
  'pro_6000',
  'pro_25000',
  'team_6000',
  'team_25000',
] as const

export const adminV1PromoCodeSchema = z.object({
  id: z.string(),
  code: z.string(),
  couponId: z.string(),
  name: z.string(),
  percentOff: z.number(),
  duration: z.string(),
  durationInMonths: z.number().nullable(),
  appliesToProductIds: z.array(z.string()).nullable(),
  maxRedemptions: z.number().nullable(),
  expiresAt: z.string().nullable(),
  active: z.boolean(),
  timesRedeemed: z.number(),
  createdAt: z.string(),
})

export const adminV1ReferralCampaignQuerySchema = z.object({
  limit: z
    .preprocess((value) => {
      const queryValue = lastQueryValue(value)
      return typeof queryValue === 'string' ? Number.parseInt(queryValue, 10) : queryValue
    }, z.number().int().catch(50))
    .catch(50)
    .transform((limit) => {
      if (limit < 1) return 50
      return Math.min(limit, 100)
    }),
  starting_after: adminV1QueryStringSchema,
  active: z
    .preprocess(lastQueryValue, z.enum(['true', 'false']).optional().catch(undefined))
    .transform((active) => (active === undefined ? undefined : active === 'true')),
})

export const adminV1ReferralCampaignBodySchema = z
  .object({
    name: z
      .string({ error: 'name is required and must be a non-empty string' })
      .trim()
      .min(1, { error: 'name is required and must be a non-empty string' }),
    percentOff: z
      .number({ error: 'percentOff must be a number between 1 and 100' })
      .finite({ error: 'percentOff must be a number between 1 and 100' })
      .min(1, { error: 'percentOff must be a number between 1 and 100' })
      .max(100, { error: 'percentOff must be a number between 1 and 100' }),
    code: z
      .union([
        z
          .string({ error: 'code must be a string or null' })
          .trim()
          .min(6, { error: 'code must be at least 6 characters' }),
        z.null(),
      ])
      .optional(),
    duration: z
      .enum(adminV1ReferralCampaignDurations, {
        error: `duration must be one of: ${adminV1ReferralCampaignDurations.join(', ')}`,
      })
      .optional()
      .default('once'),
    durationInMonths: z
      .number({
        error:
          'durationInMonths is required and must be a positive integer when duration is "repeating"',
      })
      .int({
        error:
          'durationInMonths is required and must be a positive integer when duration is "repeating"',
      })
      .min(1, {
        error:
          'durationInMonths is required and must be a positive integer when duration is "repeating"',
      })
      .optional(),
    maxRedemptions: z
      .union([
        z
          .number({ error: 'maxRedemptions must be a positive integer' })
          .int({ error: 'maxRedemptions must be a positive integer' })
          .min(1, { error: 'maxRedemptions must be a positive integer' }),
        z.null(),
      ])
      .optional(),
    expiresAt: z.union([adminV1FutureIsoDateSchema, z.null()]).optional(),
    appliesTo: z
      .union([
        z
          .array(z.enum(adminV1ReferralCampaignAppliesTo), {
            error: 'appliesTo must be a non-empty array',
          })
          .nonempty({ error: 'appliesTo must be a non-empty array' }),
        z.null(),
      ])
      .optional(),
  })
  .refine((body) => body.duration !== 'repeating' || body.durationInMonths !== undefined, {
    error:
      'durationInMonths is required and must be a positive integer when duration is "repeating"',
    path: ['durationInMonths'],
  })

const adminV1ReferralCampaignListResultSchema = z.object({
  data: z.array(adminV1PromoCodeSchema),
  hasMore: z.boolean(),
  nextCursor: z.string().optional(),
})

export const adminV1ListReferralCampaignsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/referral-campaigns',
  query: adminV1ReferralCampaignQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1ReferralCampaignListResultSchema,
  },
})

export const adminV1CreateReferralCampaignContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/referral-campaigns',
  body: adminV1ReferralCampaignBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1PromoCodeSchema),
  },
})

export type AdminV1PromoCode = z.output<typeof adminV1PromoCodeSchema>
export type AdminV1ReferralCampaignDuration = ContractBody<
  typeof adminV1CreateReferralCampaignContract
>['duration']
export type AdminV1ReferralCampaignAppliesTo = NonNullable<
  ContractBody<typeof adminV1CreateReferralCampaignContract>['appliesTo']
>[number]
export type AdminV1ListReferralCampaignsQueryInput = ContractQueryInput<
  typeof adminV1ListReferralCampaignsContract
>
export type AdminV1ListReferralCampaignsQuery = ContractQuery<
  typeof adminV1ListReferralCampaignsContract
>
export type AdminV1CreateReferralCampaignBodyInput = ContractBodyInput<
  typeof adminV1CreateReferralCampaignContract
>
export type AdminV1CreateReferralCampaignBody = ContractBody<
  typeof adminV1CreateReferralCampaignContract
>
export type AdminV1ListReferralCampaignsResponse = ContractJsonResponse<
  typeof adminV1ListReferralCampaignsContract
>
export type AdminV1CreateReferralCampaignResponse = ContractJsonResponse<
  typeof adminV1CreateReferralCampaignContract
>
