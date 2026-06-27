import { env } from '@/lib/core/config/env'

/**
 * Product slug for the shared AAC Billing Lago org (e.g. `aacworkflow` for Sim).
 * When set, customer/subscription external IDs follow `docs/architecture/saas-integration.md`.
 */
export function getLagoProductSlug(): string | null {
  const slug = env.LAGO_PRODUCT_SLUG?.trim()
  return slug || null
}

/**
 * Whether Sim uses the AAC Billing product-prefix convention for Lago IDs.
 */
export function usesLagoProductPrefix(): boolean {
  return Boolean(getLagoProductSlug())
}

/**
 * Infers Sim billing entity type from a bare external id (`org_*` → organization).
 */
export function inferLagoBillingEntityType(entityId: string): 'user' | 'organization' {
  return entityId.startsWith('org_') ? 'organization' : 'user'
}
