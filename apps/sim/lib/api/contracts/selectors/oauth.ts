import { z } from 'zod'
import { oauthTokenRequestBodySchema } from '@/lib/api/contracts/oauth-connections'
import { definePostSelector } from '@/lib/api/contracts/selectors/shared'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'

const oauthTokenResponseSchema = z
  .object({
    accessToken: z.string().optional(),
    idToken: z.string().optional(),
    instanceUrl: z.string().optional(),
    cloudId: z.string().optional(),
    domain: z.string().optional(),
  })
  .passthrough()

export const oauthTokenContract = definePostSelector(
  '/api/auth/oauth/token',
  oauthTokenRequestBodySchema,
  oauthTokenResponseSchema
)

export type OauthTokenResponse = ContractJsonResponse<typeof oauthTokenContract>
