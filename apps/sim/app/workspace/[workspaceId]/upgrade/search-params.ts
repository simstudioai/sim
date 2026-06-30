import { parseAsStringLiteral } from 'nuqs/server'
import { UPGRADE_REASONS } from '@/lib/billing/upgrade-reasons'

/**
 * Single source of truth for the upgrade page's `reason` query param.
 *
 * Nullable (no `.withDefault`): a clean URL means no reason and the page keeps
 * its generic header. Shared by the client (`useQueryState`) and any server
 * read via `createSearchParamsCache`.
 */
export const upgradeReasonParam = {
  key: 'reason',
  parser: parseAsStringLiteral(UPGRADE_REASONS),
} as const

/** Clean URLs, no back-stack churn — the reason is a passive header hint. */
export const upgradeUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
