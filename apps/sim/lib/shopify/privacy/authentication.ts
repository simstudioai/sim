import { createHash, createHmac } from 'node:crypto'
import type { ShopifyPrivacyPrincipal } from '@sim/auth/principal'
import { safeCompare } from '@sim/security/compare'
import { requireConfiguredOAuthClient } from '@/lib/core/config/env-capabilities.server'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/** Verifies the original bytes before granting app-level receipt authority. */
export function authenticateShopifyPrivacy(
  body: Uint8Array,
  signature: string | null
): ShopifyPrivacyPrincipal {
  const { values } = requireConfiguredOAuthClient('shopify')
  const expected = createHmac('sha256', values.SHOPIFY_CLIENT_SECRET).update(body).digest('base64')
  if (!signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature) || !safeCompare(signature, expected)) {
    throw new OrchestrationError('unauthorized', 'Invalid Shopify webhook signature')
  }
  return {
    kind: 'shopify_privacy',
    clientId: values.SHOPIFY_CLIENT_ID,
    payloadHash: createHash('sha256').update(body).digest('hex'),
    receivedAt: new Date(),
  }
}

/** Keeps integer lexemes exact while JSON.parse still validates the complete document. */
export function parseShopifyPrivacyJson(body: string): unknown {
  return JSON.parse(
    body.replace(
      /"(?:\\.|[^"\\])*"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      (token, number: string | undefined) => (number ? JSON.stringify(number) : token)
    )
  )
}
