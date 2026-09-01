import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const MANAGED_OAUTH_DELEGATION_HEADER = 'x-sim-managed-oauth-delegation'

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

const firstQueryStringSchema = z
  .union([z.string(), z.array(z.string()).min(1)])
  .transform((value) => (Array.isArray(value) ? value[0] : value))

export const connectedAccountsQuerySchema = z.object({
  provider: firstQueryStringSchema
    .transform((value) => value || undefined)
    .pipe(z.string().min(1).optional())
    .optional(),
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
  state: z.string().min(1, 'state is required'),
})

const oauthCredentialDraftIdSchema = z
  .string()
  .min(1, 'draftId is required')
  .max(255, 'draftId must be at most 255 characters')

export const trelloAuthorizeQuerySchema = z.object({
  returnUrl: z
    .string()
    .min(1, 'Return URL cannot be empty')
    .max(2048, 'Return URL is too long')
    .optional(),
  draftId: oauthCredentialDraftIdSchema.optional(),
})

const trelloCallbackQuerySchema = z
  .object({
    state: z.string().min(1).optional(),
    error: z.string().min(1).optional(),
  })
  .passthrough()

/** Google domain-wide-delegation subject. Also applied by in-process credential callers. */
export const impersonateEmailSchema = z.string().email()

export const oauthTokenRequestBodySchema = z
  .object({
    credentialId: z.string().min(1).optional(),
    credentialAccountUserId: z.string().min(1).optional(),
    providerId: z.string().min(1).optional(),
    toolId: z.string().min(1).optional(),
    workflowId: z.string().min(1).nullish(),
    scopes: z.array(z.string()).optional(),
    impersonateEmail: impersonateEmailSchema.optional(),
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

export const oauthTokenPostHeadersSchema = z.object({
  [MANAGED_OAUTH_DELEGATION_HEADER]: z.string().min(1).optional(),
})

const oauthTokenResponseSchema = z.object({
  accessToken: z.string(),
  credentialType: z.enum(['oauth', 'service_account']).optional(),
  idToken: z.string().optional(),
  instanceUrl: z.string().optional(),
  /** Zoho Desk — the data-center-scoped Desk REST base for this credential. */
  apiDomain: z.string().optional(),
  cloudId: z.string().optional(),
  domain: z.string().optional(),
  authStyle: z.enum(['x-api-token']).optional(),
})

/** Token material a resolved credential yields, on the wire and in-process alike. */
export type OAuthTokenResponse = z.output<typeof oauthTokenResponseSchema>

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
  headers: oauthTokenPostHeadersSchema,
  body: oauthTokenRequestBodySchema,
  response: {
    mode: 'json',
    schema: oauthTokenResponseSchema,
  },
})

export const shopifyAuthorizeQuerySchema = z.object({
  shop: z.string().optional(),
  returnUrl: z.string().optional(),
  draftId: oauthCredentialDraftIdSchema.optional(),
})

export const shopifyCallbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  shop: z.string().optional(),
})

const SHOPIFY_SHOP_DOMAIN_REGEX = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\.myshopify\.com$/
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
  query: trelloAuthorizeQuerySchema,
  response: { mode: 'redirect' },
})

export const trelloCallbackContract = defineRouteContract({
  method: 'GET',
  path: '/api/auth/trello/callback',
  query: trelloCallbackQuerySchema,
  response: { mode: 'text' },
})

const MAX_OAUTH_RETURN_URL_LENGTH = 2048
const MAX_OAUTH_CODE_LENGTH = 8192
const MAX_OAUTH_STATE_LENGTH = 256
const MAX_OAUTH_ERROR_LENGTH = 2048

export const instagramAuthorizeQuerySchema = z.object({
  returnUrl: z
    .string()
    .min(1, 'Return URL cannot be empty')
    .max(MAX_OAUTH_RETURN_URL_LENGTH, 'Return URL is too long')
    .optional(),
  workspaceId: workspaceIdSchema.optional(),
  draftId: oauthCredentialDraftIdSchema.optional(),
})

export const authorizeInstagramContract = defineRouteContract({
  method: 'GET',
  path: '/api/auth/instagram/authorize',
  query: instagramAuthorizeQuerySchema,
  response: { mode: 'redirect' },
})

export const instagramCallbackQuerySchema = z.object({
  code: z
    .string()
    .min(1, 'Authorization code cannot be empty')
    .max(MAX_OAUTH_CODE_LENGTH, 'Authorization code is too long')
    .optional(),
  state: z
    .string()
    .min(1, 'OAuth state cannot be empty')
    .max(MAX_OAUTH_STATE_LENGTH, 'OAuth state is too long')
    .optional(),
  error: z
    .string()
    .min(1, 'OAuth error cannot be empty')
    .max(MAX_OAUTH_ERROR_LENGTH, 'OAuth error is too long')
    .optional(),
  error_reason: z
    .string()
    .min(1, 'OAuth error reason cannot be empty')
    .max(MAX_OAUTH_ERROR_LENGTH, 'OAuth error reason is too long')
    .optional(),
  error_description: z
    .string()
    .min(1, 'OAuth error description cannot be empty')
    .max(MAX_OAUTH_ERROR_LENGTH, 'OAuth error description is too long')
    .optional(),
})

export const instagramCallbackContract = defineRouteContract({
  method: 'GET',
  path: '/api/auth/oauth2/callback/instagram',
  query: instagramCallbackQuerySchema,
  response: { mode: 'redirect' },
})

export const authorizeOAuth2QuerySchema = z
  .object({
    draftId: oauthCredentialDraftIdSchema.optional(),
    providerId: z.string().min(1, 'providerId is required').optional(),
    workspaceId: workspaceIdSchema.optional(),
    callbackURL: z.string().min(1).optional(),
    credentialId: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.draftId) {
      for (const field of ['providerId', 'workspaceId', 'callbackURL', 'credentialId'] as const) {
        if (data[field] !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} cannot be combined with draftId`,
          })
        }
      }
      return
    }
    if (!data.providerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['providerId'],
        message: 'providerId is required',
      })
    }
    if (!data.workspaceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workspaceId'],
        message: 'workspaceId is required',
      })
    }
  })

export const authorizeOAuth2Contract = defineRouteContract({
  method: 'GET',
  path: '/api/auth/oauth2/authorize',
  query: authorizeOAuth2QuerySchema,
  response: { mode: 'redirect' },
})

export type StoreTrelloTokenBody = ContractBody<typeof storeTrelloTokenContract>
export type StoreTrelloTokenBodyInput = ContractBodyInput<typeof storeTrelloTokenContract>
export type StoreTrelloTokenResponse = ContractJsonResponse<typeof storeTrelloTokenContract>
