import type { ShareResourceType } from '@/lib/api/contracts/public-shares'
import { getBaseUrl } from '@/lib/core/utils/urls'

/**
 * Client-safe share URL helpers.
 *
 * `share-manager.ts` imports `@sim/db` and is therefore server-only, which is
 * why share modals used to re-derive the public link by hand and would have
 * handed an interface share a `/f/` link that 404s. Both sides import this
 * module instead, so a share's link has exactly one definition.
 */

/**
 * Public path segment per shared resource type. Folders ride the file page.
 */
export const SHARE_PATH_PREFIX = {
  file: 'f',
  folder: 'f',
  interface: 'i',
} as const satisfies Record<ShareResourceType, string>

/** Public share URL for a token, e.g. `{baseUrl}/i/{token}`. */
export function buildShareUrl(resourceType: ShareResourceType, token: string): string {
  return `${getBaseUrl()}/${SHARE_PATH_PREFIX[resourceType]}/${token}`
}
