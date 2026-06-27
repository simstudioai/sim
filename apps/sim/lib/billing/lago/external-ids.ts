import type { LagoBillingEntityType } from '@/lib/billing/lago/types'
import {
  getLagoProductSlug,
  inferLagoBillingEntityType,
  usesLagoProductPrefix,
} from '@/lib/billing/lago/product'

const USER_PREFIX = 'user:'
const ORG_PREFIX = 'org:'

/**
 * Builds the Lago customer external_id for a Sim billing entity.
 */
export function toLagoCustomerExternalId(
  entityType: LagoBillingEntityType,
  entityId: string
): string {
  if (usesLagoProductPrefix()) {
    return entityId
  }
  return entityType === 'organization' ? `${ORG_PREFIX}${entityId}` : `${USER_PREFIX}${entityId}`
}

/**
 * Builds the Lago subscription external_id for a Sim billing entity.
 */
export function toLagoSubscriptionExternalId(
  entityType: LagoBillingEntityType,
  entityId: string
): string | null {
  const slug = getLagoProductSlug()
  if (!slug) return null
  return `${slug}:${entityId}`
}

/**
 * Parses a Lago subscription external_id (`{product}:{entityId}`) into a Sim billing entity.
 */
export function fromLagoSubscriptionExternalId(externalId: string): {
  entityType: LagoBillingEntityType
  entityId: string
} | null {
  const slug = getLagoProductSlug()
  if (!slug || !externalId.startsWith(`${slug}:`)) {
    return null
  }
  const entityId = externalId.slice(slug.length + 1)
  if (!entityId) return null
  return {
    entityType: inferLagoBillingEntityType(entityId),
    entityId,
  }
}

/**
 * Parses a Lago customer external_id back into a Sim billing entity.
 */
export function fromLagoCustomerExternalId(externalId: string): {
  entityType: LagoBillingEntityType
  entityId: string
} | null {
  if (externalId.startsWith(ORG_PREFIX)) {
    return { entityType: 'organization', entityId: externalId.slice(ORG_PREFIX.length) }
  }
  if (externalId.startsWith(USER_PREFIX)) {
    return { entityType: 'user', entityId: externalId.slice(USER_PREFIX.length) }
  }

  const fromSubscription = fromLagoSubscriptionExternalId(externalId)
  if (fromSubscription) {
    return fromSubscription
  }

  if (usesLagoProductPrefix() || externalId.startsWith('org_')) {
    return {
      entityType: inferLagoBillingEntityType(externalId),
      entityId: externalId,
    }
  }

  return null
}
