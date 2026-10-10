import { createHash } from 'node:crypto'
import { toRecord } from '@sim/utils/object'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { requireConfiguredOAuthClient } from '@/lib/core/config/env-capabilities.server'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { parseShopifyPrivacyJson } from '@/lib/shopify/privacy/authentication'
import { storeShopifyPrivacyReceipt } from '@/lib/shopify/privacy/requests'
import type { ShopifyPrivacyTopic } from '@/lib/shopify/privacy/types'

// permission-group-exempt: verified provider ingress records a privacy case without granting user or workspace access
const operation = Object.freeze({
  id: 'shopify.privacy.receive',
  capability: 'none',
  principalKinds: ['shopify_privacy'] as const,
})

interface ReceivePrivacyInput {
  topic: ShopifyPrivacyTopic
  webhookId: string
  rawBody: string
}

/** Signed app authority can create a durable case, never erase a tenant's data. */
export const receiveShopifyPrivacyRequest: OperationUseCase<
  typeof operation,
  ReceivePrivacyInput,
  void
> = {
  operation,
  async execute({ principal, input }) {
    if (
      principal.kind !== 'shopify_privacy' ||
      !Number.isFinite(principal.receivedAt.getTime()) ||
      principal.receivedAt.getTime() > Date.now() ||
      Date.now() - principal.receivedAt.getTime() > 60_000
    )
      throw new OrchestrationError('forbidden', 'Verified Shopify privacy authority is required')
    const { values } = requireConfiguredOAuthClient('shopify')
    if (
      principal.clientId !== values.SHOPIFY_CLIENT_ID ||
      principal.payloadHash !== createHash('sha256').update(input.rawBody).digest('hex')
    )
      throw new OrchestrationError(
        'forbidden',
        'Shopify privacy authority does not match the receipt'
      )
    const payload = toRecord(parseShopifyPrivacyJson(input.rawBody))
    if (typeof payload.shop_id !== 'string' || typeof payload.shop_domain !== 'string') {
      throw new OrchestrationError('validation', 'Signed Shopify shop identity is required')
    }
    await storeShopifyPrivacyReceipt({
      clientId: principal.clientId,
      webhookId: input.webhookId,
      topic: input.topic,
      shopId: payload.shop_id,
      shopDomain: payload.shop_domain,
      payloadHash: principal.payloadHash,
      rawBody: input.rawBody,
      receivedAt: principal.receivedAt,
    })
  },
}
