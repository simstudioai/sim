import type { ManagedOAuthSite } from '@sim/db/schema'
import { toArray, toRecord } from '@sim/utils/object'
import {
  ACCOUNT_SITE_LIMIT,
  ACCOUNT_SITE_NAME_MAX_LENGTH,
  ACCOUNT_SITE_URL_MAX_LENGTH,
} from '@/lib/credential-groups/limits'

/**
 * Keeps the well-formed sites within the recorded bounds. Site lists are display data from a
 * provider, so a bad entry is dropped rather than allowed to fail the account it belongs to.
 */
export function boundedAccountSites(value: unknown): ManagedOAuthSite[] {
  return toArray(value)
    .flatMap((entry) => {
      const site = toRecord(entry)
      const name = typeof site.name === 'string' ? site.name.trim() : ''
      const url = typeof site.url === 'string' ? site.url : ''
      return name &&
        url &&
        name.length <= ACCOUNT_SITE_NAME_MAX_LENGTH &&
        url.length <= ACCOUNT_SITE_URL_MAX_LENGTH
        ? [{ name, url }]
        : []
    })
    .slice(0, ACCOUNT_SITE_LIMIT)
}
