import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import { SHOPIFY_PRIVACY_STORES, SHOPIFY_PRIVACY_TOPICS } from '@/lib/shopify/privacy/types'

const providerId = z.string().regex(/^[1-9]\d{0,19}$/, 'Expected an exact positive Shopify ID')
const customer = z
  .object({
    id: providerId.optional(),
    email: z.string().max(320).nullable().optional(),
    phone: z.string().max(100).nullable().optional(),
  })
  .refine(
    (value) => Boolean(value.id || value.email || value.phone),
    'Customer identity is required'
  )
const common = {
  shop_id: providerId,
  shop_domain: z
    .string()
    .max(255)
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/),
}

export const shopifyPrivacyTopicSchema = z.enum(SHOPIFY_PRIVACY_TOPICS)

export const shopifyPrivacyPayloadSchemas = {
  'customers/data_request': z.object({
    ...common,
    customer,
    orders_requested: z.array(providerId).max(250_000),
    data_request: z.object({ id: providerId }),
    orders_to_redact: z.never().optional(),
  }),
  'customers/redact': z.object({
    ...common,
    customer,
    orders_to_redact: z.array(providerId).max(250_000),
    orders_requested: z.never().optional(),
    data_request: z.never().optional(),
  }),
  'shop/redact': z.object({
    ...common,
    customer: z.never().optional(),
    orders_requested: z.never().optional(),
    orders_to_redact: z.never().optional(),
    data_request: z.never().optional(),
  }),
} as const

const shopifyPrivacyReceiptSchema = z.object({ accepted: z.literal(true) })

export const shopifyPrivacyWebhookContract = defineRouteContract({
  method: 'POST',
  path: '/api/webhooks/shopify/privacy',
  response: { mode: 'json', schema: shopifyPrivacyReceiptSchema },
})

const shopifyPrivacyCaseParamsSchema = z.object({ requestId: z.string().uuid() })

const shopifyPrivacyListQuerySchema = z.object({
  after: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  openOnly: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
})

const shopifyPrivacyEvidenceSchema = z
  .object({
    store: z.enum(SHOPIFY_PRIVACY_STORES),
    outcome: z.enum(['exported', 'erased', 'no_data', 'legal_hold']),
    recordReference: z.string().trim().min(1).max(1000),
    summary: z.string().trim().min(1).max(2000),
  })
  .strict()

const revision = z.number().int().min(0).max(2_147_483_647)
const shopifyPrivacyReviewBodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign'), revision }).strict(),
  z
    .object({
      action: z.literal('record_evidence'),
      revision,
      scopeReviewed: z.boolean(),
      evidence: z.array(shopifyPrivacyEvidenceSchema).min(1).max(9),
      deliveryReference: z.string().trim().min(1).max(1000).optional(),
    })
    .strict(),
  z.object({ action: z.literal('complete'), revision }).strict(),
  z
    .object({
      action: z.literal('legal_hold'),
      revision,
      evidence: z.array(shopifyPrivacyEvidenceSchema).min(1).max(9),
    })
    .strict(),
])

const shopifyPrivacyCaseSummarySchema = z.object({
  id: z.string(),
  topic: shopifyPrivacyTopicSchema,
  shopId: z.string(),
  shopDomain: z.string(),
  status: z.enum(['received', 'awaiting_review', 'processing', 'legal_hold', 'completed']),
  assignedToUserId: z.string().nullable(),
  revision: z.number(),
  receivedAt: z.string(),
  dueAt: z.string(),
  escalatedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  completedByUserId: z.string().nullable(),
})

export const shopifyPrivacyListResponseSchema = z.object({
  requests: z.array(shopifyPrivacyCaseSummarySchema),
  nextCursor: z.string().nullable(),
})
export type ShopifyPrivacyListResponse = z.output<typeof shopifyPrivacyListResponseSchema>

export const shopifyPrivacyDetailResponseSchema = z.object({
  request: shopifyPrivacyCaseSummarySchema,
  requestPayload: z.string().nullable(),
  review: z
    .object({
      scopeReviewed: z.boolean(),
      evidence: z.array(shopifyPrivacyEvidenceSchema),
      deliveryReference: z.string().optional(),
      reviewedByUserId: z.string(),
      reviewedAt: z.string(),
    })
    .nullable(),
  scopes: z.array(
    z.object({
      id: z.string(),
      ownerType: z.string(),
      ownerId: z.string(),
      accountId: z.string(),
      credentialId: z.string(),
      firstSeenAt: z.string(),
      lastSeenAt: z.string(),
    })
  ),
  nextScopeCursor: z.string().nullable(),
  discoveryComplete: z.literal(false),
  requiredStores: z.array(z.enum(SHOPIFY_PRIVACY_STORES)),
  limitation: z.string(),
})
export type ShopifyPrivacyDetailResponse = z.output<typeof shopifyPrivacyDetailResponseSchema>

const shopifyPrivacyDetailQuerySchema = z.object({
  afterScope: z.string().uuid().optional(),
})

const shopifyPrivacyReviewResponseSchema = z.object({
  revision: z.number(),
  status: z.string(),
})

export const listShopifyPrivacyContract = defineRouteContract({
  method: 'GET',
  path: '/api/admin/shopify/privacy',
  query: shopifyPrivacyListQuerySchema,
  response: { mode: 'json', schema: shopifyPrivacyListResponseSchema },
})
export const readShopifyPrivacyContract = defineRouteContract({
  method: 'GET',
  path: '/api/admin/shopify/privacy/[requestId]',
  params: shopifyPrivacyCaseParamsSchema,
  query: shopifyPrivacyDetailQuerySchema,
  response: { mode: 'json', schema: shopifyPrivacyDetailResponseSchema },
})
export const reviewShopifyPrivacyContract = defineRouteContract({
  method: 'POST',
  path: '/api/admin/shopify/privacy/[requestId]',
  params: shopifyPrivacyCaseParamsSchema,
  body: shopifyPrivacyReviewBodySchema,
  response: { mode: 'json', schema: shopifyPrivacyReviewResponseSchema },
})
