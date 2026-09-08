import type { QueryClient } from '@tanstack/react-query'
import { prefetchCurrentUserSettings } from '@/lib/settings/prefetch-current-user-settings'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'

export interface SettingsSectionPrefetchContext {
  workspaceId: string
}

/**
 * First-paint prefetches keyed by section. Keep this sparse: each entry blocks dehydration,
 * must preserve authorization and route projection, and must match the client hook's cache shape.
 * Never bypass a route that redacts sensitive fields.
 */
export const SECTION_PREFETCHERS: Partial<
  Record<
    SettingsSection,
    (queryClient: QueryClient, context: SettingsSectionPrefetchContext) => Promise<unknown>
  >
> = {
  general: (queryClient) => prefetchCurrentUserSettings(queryClient),
  billing: (queryClient) => prefetchCurrentUserSettings(queryClient),
  admin: (queryClient) => prefetchCurrentUserSettings(queryClient),
}
