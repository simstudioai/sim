import { z } from 'zod'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const credentialIdSchema = z.string().trim().min(1).max(512)
const workspaceIdSchema = z.string().trim().min(1).max(512)
const shortTextSchema = z.string().trim().min(1).max(256)
const countryCodesSchema = z.array(z.string().length(2)).min(1).max(20)

export const plaidOptionsBodySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('accounts'),
      workspaceId: workspaceIdSchema,
      credentialId: credentialIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('institution_search'),
      workspaceId: workspaceIdSchema,
      credentialId: credentialIdSchema,
      query: z.string().trim().min(1).max(256),
      country_codes: countryCodesSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('institution_detail'),
      workspaceId: workspaceIdSchema,
      credentialId: credentialIdSchema,
      institution_id: shortTextSchema,
      country_codes: countryCodesSchema,
    })
    .strict(),
])

export const plaidOptionSchema = z.object({
  id: shortTextSchema,
  label: z.string().trim().min(1).max(512),
})

export const plaidOptionsResponseSchema = z.object({
  options: z.array(plaidOptionSchema).max(500),
})

export const plaidOptionsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/plaid/options',
  body: plaidOptionsBodySchema,
  response: { mode: 'json', schema: plaidOptionsResponseSchema },
})

export type PlaidOptionsBody = ContractBodyInput<typeof plaidOptionsContract>
export type PlaidOptionsResponse = ContractJsonResponse<typeof plaidOptionsContract>
