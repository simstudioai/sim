import {
  listShopifyPrivacyContract,
  type ShopifyPrivacyListResponse,
  shopifyPrivacyListResponseSchema,
} from '@/lib/api/contracts/shopify-privacy'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { listShopifyPrivacyRequests } from '@/lib/shopify/privacy/application/read-requests'

export const GET = defineInternalJsonRoute({
  contract: listShopifyPrivacyContract,
  auth: internalSessionAuth,
  operation: listShopifyPrivacyRequests.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'shopify-privacy-admin' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ query }) => query,
  useCase: listShopifyPrivacyRequests,
  present: (result): ShopifyPrivacyListResponse => shopifyPrivacyListResponseSchema.parse(result),
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
