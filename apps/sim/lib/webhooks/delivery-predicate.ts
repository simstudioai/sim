import type { webhook } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'

type WebhookDeliveryColumns = Pick<typeof webhook, 'archivedAt' | 'isActive'>

export type LegacyWebhookDeliveryPolicy = 'active_unarchived' | 'active_only'

/**
 * Builds the current webhook-row delivery predicate without assuming future lifecycle columns.
 *
 * Most delivery consumers exclude archived rows. The active-only policy exists solely to preserve
 * legacy consumers that historically scanned archived active rows, such as subscription renewal.
 */
export function deliverableWebhookPredicate(
  columns: WebhookDeliveryColumns,
  policy: LegacyWebhookDeliveryPolicy = 'active_unarchived'
) {
  const activePredicate = eq(columns.isActive, true)
  if (policy === 'active_only') return activePredicate
  return and(activePredicate, isNull(columns.archivedAt))
}
