import { z } from 'zod'
import { shopifyShopDomainSchema } from '@/lib/api/contracts/oauth-connections'
import { defineRouteContract } from '@/lib/api/contracts/types'

const shopifyInstallQuerySchema = z.object({
  shop: shopifyShopDomainSchema,
  timestamp: z.string().regex(/^\d{10,13}$/),
  hmac: z.string().regex(/^[a-f0-9]{64}$/),
})

export const shopifyInstallContract = defineRouteContract({
  method: 'GET',
  path: '/api/auth/shopify/install',
  query: shopifyInstallQuerySchema,
  response: { mode: 'redirect' },
})

const completeShopifyInstallBodySchema = z.object({
  attemptId: z.string().uuid(),
  workspaceId: z.string().min(1).max(255),
  displayName: z.string().trim().min(1).max(255).optional(),
})
export type CompleteShopifyInstallBody = z.infer<typeof completeShopifyInstallBodySchema>

const completeShopifyInstallResponseSchema = z.object({
  credentialId: z.string().min(1),
  workspaceId: z.string().min(1),
})

export const completeShopifyInstallContract = defineRouteContract({
  method: 'POST',
  path: '/api/auth/shopify/complete',
  body: completeShopifyInstallBodySchema,
  response: { mode: 'json', schema: completeShopifyInstallResponseSchema },
})
