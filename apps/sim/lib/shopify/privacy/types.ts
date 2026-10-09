export const SHOPIFY_PRIVACY_TOPICS = [
  'customers/data_request',
  'customers/redact',
  'shop/redact',
] as const

export type ShopifyPrivacyTopic = (typeof SHOPIFY_PRIVACY_TOPICS)[number]

export const SHOPIFY_PRIVACY_STORES = [
  'installation_scope',
  'workflow_executions',
  'chats',
  'files',
  'tables',
  'knowledge',
  'saved_workflows',
  'external_processors',
  'backups',
] as const

type ShopifyPrivacyStore = (typeof SHOPIFY_PRIVACY_STORES)[number]

export interface ShopifyPrivacyEvidence {
  store: ShopifyPrivacyStore
  outcome: 'exported' | 'erased' | 'no_data' | 'legal_hold'
  recordReference: string
  summary: string
}

export interface ShopifyPrivacyReview {
  scopeReviewed: boolean
  evidence: ShopifyPrivacyEvidence[]
  deliveryReference?: string
  reviewedByUserId: string
  reviewedAt: string
}
