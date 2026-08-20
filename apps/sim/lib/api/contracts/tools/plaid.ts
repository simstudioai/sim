import { z } from 'zod'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const credentialIdSchema = z.string().trim().min(1).max(512)
const providerTextSchema = z.string().trim().min(1)
export const PLAID_SUPPORTED_COUNTRY_CODES = [
  'US',
  'GB',
  'ES',
  'NL',
  'FR',
  'IE',
  'CA',
  'DE',
  'IT',
  'PL',
  'DK',
  'NO',
  'SE',
  'EE',
  'LT',
  'LV',
  'PT',
  'BE',
  'AT',
  'FI',
] as const
export type PlaidSupportedCountryCode = (typeof PLAID_SUPPORTED_COUNTRY_CODES)[number]
const countryCodesSchema = z
  .array(z.enum(PLAID_SUPPORTED_COUNTRY_CODES))
  .min(1)
  .max(PLAID_SUPPORTED_COUNTRY_CODES.length)
const accountIdsSchema = z.array(providerTextSchema).min(1)

const baseShape = {
  credentialId: credentialIdSchema,
}

const emptyInputSchema = z.object({}).strict()
const accountFilterInputSchema = z
  .object({
    account_ids: accountIdsSchema.optional(),
  })
  .strict()

export const plaidOperationBodySchema = z.discriminatedUnion('operation', [
  z
    .object({
      ...baseShape,
      operation: z.literal('plaid_get_item'),
      input: emptyInputSchema,
    })
    .strict(),
  z
    .object({
      ...baseShape,
      operation: z.literal('plaid_sync_transactions'),
      input: z
        .object({
          cursor: z.string().optional(),
          count: z.number().int().min(1).max(500).optional(),
          account_id: providerTextSchema.optional(),
          include_original_description: z.boolean().optional(),
          days_requested: z.number().int().min(1).max(730).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...baseShape,
      operation: z.literal('plaid_search_institutions'),
      input: z
        .object({
          query: providerTextSchema,
          country_codes: countryCodesSchema,
          products: z.array(providerTextSchema).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...baseShape,
      operation: z.literal('plaid_get_institution'),
      input: z
        .object({
          institution_id: providerTextSchema,
          country_codes: countryCodesSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...baseShape,
      operation: z.literal('plaid_get_accounts'),
      input: accountFilterInputSchema,
    })
    .strict(),
  z
    .object({
      ...baseShape,
      operation: z.literal('plaid_get_balances'),
      input: z
        .object({
          account_ids: accountIdsSchema.optional(),
          min_last_updated_datetime: z.iso.datetime({ offset: true }).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...baseShape,
      operation: z.literal('plaid_get_auth'),
      input: accountFilterInputSchema,
    })
    .strict(),
  z
    .object({
      ...baseShape,
      operation: z.literal('plaid_get_identity'),
      input: accountFilterInputSchema,
    })
    .strict(),
])

export const plaidOperationResponseSchema = z.record(z.string(), z.unknown())

export const plaidOperationContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/plaid',
  body: plaidOperationBodySchema,
  response: {
    mode: 'json',
    // untyped-response: successful Plaid payloads vary by operation and are validated by the matching tool transform
    schema: plaidOperationResponseSchema,
  },
})

export type PlaidOperationBody = ContractBodyInput<typeof plaidOperationContract>
export type PlaidOperationResponse = ContractJsonResponse<typeof plaidOperationContract>
