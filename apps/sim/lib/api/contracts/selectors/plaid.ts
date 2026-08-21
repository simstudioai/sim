import { z } from 'zod'
import { plaidCountryCodesSchema } from '@/lib/api/contracts/tools/plaid'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const credentialIdSchema = z.string().trim().min(1).max(512)
const workspaceIdSchema = z.string().trim().min(1).max(512)
const providerTextSchema = z.string().trim().min(1)
const accountEligibilitySchema = z.enum(['all', 'auth', 'transactions'])
export const PLAID_OPTIONS_REQUEST_MAX_BYTES = 64 * 1024

export const plaidOptionsBodySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('accounts'),
      workspaceId: workspaceIdSchema,
      credentialId: credentialIdSchema,
      eligibility: accountEligibilitySchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('institution_search'),
      workspaceId: workspaceIdSchema,
      credentialId: credentialIdSchema,
      query: providerTextSchema,
      country_codes: plaidCountryCodesSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('institution_detail'),
      workspaceId: workspaceIdSchema,
      credentialId: credentialIdSchema,
      institution_id: providerTextSchema,
      country_codes: plaidCountryCodesSchema,
    })
    .strict(),
])

export const plaidOptionSchema = z.object({
  id: providerTextSchema,
  label: z.string().trim().min(1).max(512),
})

export const plaidOptionsResponseSchema = z.object({
  options: z.array(plaidOptionSchema),
})

export const plaidOptionsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/plaid/options',
  body: plaidOptionsBodySchema,
  response: { mode: 'json', schema: plaidOptionsResponseSchema },
})

export type PlaidOptionsBody = ContractBodyInput<typeof plaidOptionsContract>
export type PlaidOptionsResponse = ContractJsonResponse<typeof plaidOptionsContract>
