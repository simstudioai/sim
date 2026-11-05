import {
  getLegacyAccessRequestsQuery,
  getLegacyAccessRequestsSettingsQuery,
} from '@/ee/access-requests/lib/navigation'

/** Resolve saved review tabs and email links before applying the destination section's gate. */
export function resolveLegacyRequestLink(
  section: string,
  query: Record<string, string | string[] | undefined>
): string | null {
  const params =
    section === 'requests' && query.view === 'admin'
      ? new URLSearchParams(getLegacyAccessRequestsSettingsQuery(query))
      : getLegacyAccessRequestsQuery(section, query)
  if (!params) return null
  for (const key of ['state', 'theme', 'plan']) {
    const value = query[key]
    if (typeof value === 'string') params.set(key, value)
  }
  return params.size ? `/settings/requests?${params}` : '/settings/requests'
}
