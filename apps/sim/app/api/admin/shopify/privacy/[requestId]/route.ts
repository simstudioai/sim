import {
  readShopifyPrivacyContract,
  reviewShopifyPrivacyContract,
  type ShopifyPrivacyDetailResponse,
  shopifyPrivacyDetailResponseSchema,
} from '@/lib/api/contracts/shopify-privacy'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { readShopifyPrivacyRequest } from '@/lib/shopify/privacy/application/read-requests'
import { reviewShopifyPrivacyRequest } from '@/lib/shopify/privacy/application/review-request'

export const GET = defineInternalJsonRoute({
  contract: readShopifyPrivacyContract,
  auth: internalSessionAuth,
  operation: readShopifyPrivacyRequest.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'shopify-privacy-admin' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({ ...params, ...query }),
  useCase: readShopifyPrivacyRequest,
  present: (result): ShopifyPrivacyDetailResponse =>
    shopifyPrivacyDetailResponseSchema.parse(result),
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})

export const POST = defineInternalJsonRoute({
  contract: reviewShopifyPrivacyContract,
  auth: internalSessionAuth,
  operation: reviewShopifyPrivacyRequest.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'shopify-privacy-admin' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: reviewShopifyPrivacyRequest,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
