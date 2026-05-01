import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const oauthAccountSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
})
export type OAuthAccountSummary = z.output<typeof oauthAccountSummarySchema>

export const oauthConnectionSchema = z.object({
  provider: z.string(),
  baseProvider: z.string(),
  featureType: z.string(),
  isConnected: z.boolean(),
  accounts: z.array(oauthAccountSummarySchema),
  lastConnected: z.string(),
  scopes: z.array(z.string()),
})
export type OAuthConnection = z.output<typeof oauthConnectionSchema>

export const disconnectOAuthBodySchema = z.object({
  provider: z.string({ error: 'Provider is required' }).min(1, 'Provider is required'),
  providerId: z.string().optional(),
  accountId: z.string().optional(),
})

export const connectedAccountsQuerySchema = z.object({
  provider: z.string().min(1).optional(),
})

export const connectedAccountSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  providerId: z.string(),
  displayName: z.string(),
})
export type ConnectedAccount = z.output<typeof connectedAccountSchema>

export const trelloTokenBodySchema = z.object({
  token: z.string().min(1),
})

const emptyTrelloAuthQuerySchema = z.object({}).passthrough()

export const oauthTokenRequestBodySchema = z
  .object({
    credentialId: z.string().min(1).optional(),
    credentialAccountUserId: z.string().min(1).optional(),
    providerId: z.string().min(1).optional(),
    workflowId: z.string().min(1).nullish(),
    scopes: z.array(z.string()).optional(),
    impersonateEmail: z.string().email().optional(),
  })
  .refine(
    (data) => data.credentialId || (data.credentialAccountUserId && data.providerId),
    'Either credentialId or (credentialAccountUserId + providerId) is required'
  )

export const oauthTokenGetQuerySchema = z.object({
  credentialId: z
    .string({
      error: 'Credential ID is required',
    })
    .min(1, 'Credential ID is required'),
})

export const oauthTokenPostQuerySchema = z.object({
  userId: z.string().min(1).optional(),
})

const oauthTokenResponseSchema = z.object({
  accessToken: z.string(),
  idToken: z.string().optional(),
  instanceUrl: z.string().optional(),
})

export const oauthTokenGetContract = defineRouteContract({
  method: 'GET',
  path: '/api/auth/oauth/token',
  query: oauthTokenGetQuerySchema,
  response: {
    mode: 'json',
    schema: oauthTokenResponseSchema,
  },
})

export const oauthTokenPostContract = defineRouteContract({
  method: 'POST',
  path: '/api/auth/oauth/token',
  query: oauthTokenPostQuerySchema,
  body: oauthTokenRequestBodySchema,
  response: {
    mode: 'json',
    schema: oauthTokenResponseSchema,
  },
})

export const shopifyAuthorizeQuerySchema = z.object({
  shop: z.string().optional(),
  returnUrl: z.string().optional(),
})

export const shopifyCallbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  shop: z.string().optional(),
})

export const shopifyStoreCookieSchema = z.object({
  accessToken: z.string().min(1),
  shopDomain: z.string().min(1),
  scope: z.string().optional(),
  returnUrl: z.string().optional(),
})

export const oauthAuthorizeParamsQuerySchema = z.object({
  consent_code: z.string({ error: 'consent_code is required' }).min(1, 'consent_code is required'),
})

export const oauthAuthorizeParamsResponseSchema = z.object({
  client_id: z.string(),
  redirect_uri: z.string(),
  scope: z.string(),
  code_challenge: z.string(),
  code_challenge_method: z.string(),
  state: z.string().nullable(),
  nonce: z.string().nullable(),
  response_type: z.literal('code'),
})

const SHOPIFY_SHOP_DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/
export const shopifyShopDomainSchema = z.string().regex(SHOPIFY_SHOP_DOMAIN_REGEX)

export const listOAuthConnectionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/auth/oauth/connections',
  response: {
    mode: 'json',
    schema: z.object({
      connections: z.array(oauthConnectionSchema),
    }),
  },
})

export const oauthAuthorizeParamsContract = defineRouteContract({
  method: 'GET',
  path: '/api/auth/oauth2/authorize-params',
  query: oauthAuthorizeParamsQuerySchema,
  response: {
    mode: 'json',
    schema: oauthAuthorizeParamsResponseSchema,
  },
})

export const disconnectOAuthContract = defineRouteContract({
  method: 'POST',
  path: '/api/auth/oauth/disconnect',
  body: disconnectOAuthBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})

export const listConnectedAccountsContract = defineRouteContract({
  method: 'GET',
  path: '/api/auth/accounts',
  query: connectedAccountsQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      accounts: z.array(connectedAccountSchema),
    }),
  },
})

export const storeTrelloTokenContract = defineRouteContract({
  method: 'POST',
  path: '/api/auth/trello/store',
  body: trelloTokenBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
})

export const authorizeTrelloContract = defineRouteContract({
  method: 'GET',
  path: '/api/auth/trello/authorize',
  query: emptyTrelloAuthQuerySchema,
  response: { mode: 'redirect' },
})

export const trelloCallbackContract = defineRouteContract({
  method: 'GET',
  path: '/api/auth/trello/callback',
  query: emptyTrelloAuthQuerySchema,
  response: { mode: 'text' },
})

export type StoreTrelloTokenBody = ContractBody<typeof storeTrelloTokenContract>
export type StoreTrelloTokenBodyInput = ContractBodyInput<typeof storeTrelloTokenContract>
export type StoreTrelloTokenResponse = ContractJsonResponse<typeof storeTrelloTokenContract>
export type OAuthAuthorizeParamsResponse = ContractJsonResponse<typeof oauthAuthorizeParamsContract>
