import {
  getAccessRequestsSettingsHref,
  getLegacyAccessRequestsSettingsQuery,
} from '@/ee/access-requests/lib/navigation'

/**
 * The organization Settings URL an old access-requests link now opens, with its requester or
 * reviewer view carried over from the link's query.
 */
export function accessRequestsSettingsUrl(
  organizationId: string,
  query: Record<string, string | string[] | undefined>
): string {
  return (
    getAccessRequestsSettingsHref({ kind: 'organization', organizationId }) +
    getLegacyAccessRequestsSettingsQuery(query)
  )
}
