import { getLegacyAccessRequestsSettingsQuery } from '@/ee/access-requests/lib/navigation'

/** The query a legacy request link means once in Settings, for the section's server render. */
export function legacyRequestsQuery(query: Record<string, string | string[] | undefined>): string {
  return getLegacyAccessRequestsSettingsQuery(query)
}
