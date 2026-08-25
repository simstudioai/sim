import { z } from 'zod'
import {
  credentialWorkflowImpersonateBodySchema,
  definePostSelector,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'

const googleAnalyticsAccountSchema = z
  .object({
    name: z.string(),
    displayName: z.string().optional(),
  })
  .passthrough()

const googleAnalyticsPropertySchema = z
  .object({
    property: z.string(),
    displayName: z.string().optional(),
    accountDisplayName: z.string().optional(),
  })
  .passthrough()

export const googleAnalyticsAccountsBodySchema = credentialWorkflowImpersonateBodySchema

export const googleAnalyticsPropertiesBodySchema = credentialWorkflowImpersonateBodySchema

export const googleAnalyticsAccountsSelectorContract = definePostSelector(
  '/api/tools/google_analytics/accounts',
  googleAnalyticsAccountsBodySchema,
  z.object({ accounts: z.array(googleAnalyticsAccountSchema), truncated: z.boolean() })
)

export const googleAnalyticsPropertiesSelectorContract = definePostSelector(
  '/api/tools/google_analytics/properties',
  googleAnalyticsPropertiesBodySchema,
  z.object({ properties: z.array(googleAnalyticsPropertySchema), truncated: z.boolean() })
)

export type GoogleAnalyticsAccountsSelectorBody = ContractBodyInput<
  typeof googleAnalyticsAccountsSelectorContract
>
export type GoogleAnalyticsPropertiesSelectorBody = ContractBodyInput<
  typeof googleAnalyticsPropertiesSelectorContract
>

export type GoogleAnalyticsAccountsSelectorResponse = ContractJsonResponse<
  typeof googleAnalyticsAccountsSelectorContract
>
export type GoogleAnalyticsPropertiesSelectorResponse = ContractJsonResponse<
  typeof googleAnalyticsPropertiesSelectorContract
>
