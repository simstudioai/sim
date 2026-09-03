import {
  buildUnifiedSettingsCatalog,
  toSettingsHeaderMeta,
  type UnifiedNavigationSection,
  type UnifiedSettingsNavigationItem,
  type UnifiedSettingsSection,
} from '@/components/settings/navigation'
import type { SettingsHeaderMeta } from '@/components/settings/settings-header'

export type SettingsSection = UnifiedSettingsSection

export type NavigationSection = UnifiedNavigationSection

export type NavigationItem = UnifiedSettingsNavigationItem

export const sectionConfig: { key: NavigationSection; title: string }[] = [
  { key: 'account', title: 'Account' },
  { key: 'workspace', title: 'Workspace' },
  { key: 'organization', title: 'Organization' },
  { key: 'platform', title: 'Platform' },
]

/** Unfiltered; the sidebar applies deployment and entitlement visibility from the host context. */
export const allNavigationItems: NavigationItem[] = buildUnifiedSettingsCatalog()

/**
 * Catalog entries indexed by id. Every routed navigation resolves a section, so the
 * lookup runs on each settings request rather than only on the ones that render a list.
 * Built first-wins to match the `find` it replaces.
 */
const navigationItemsById = new Map<SettingsSection, NavigationItem>()
for (const item of allNavigationItems) {
  if (!navigationItemsById.has(item.id)) navigationItemsById.set(item.id, item)
}

/**
 * Section segments that are no longer canonical but must keep resolving, so old links
 * and bookmarks survive. Kept beside the catalog because the route layout, the page's
 * access gate, and `generateMetadata` all have to normalize a segment identically.
 */
const SECTION_ALIASES: Readonly<Record<string, SettingsSection>> = {
  subscription: 'billing',
  team: 'organization',
  'api-keys': 'apikeys',
  /** Verified domains moved into the SSO page. */
  domains: 'sso',
}

export interface ResolvedSettingsSection {
  id: SettingsSection
  meta: SettingsHeaderMeta
}

/**
 * Normalizes a routed `[section]` segment to its catalog entry, or `null` when the
 * segment names no known section. Availability is not considered here — whether the
 * viewer may open a section is the page gate's decision, not the route's.
 */
export function resolveSettingsSection(section: string): ResolvedSettingsSection | null {
  const item = navigationItemsById.get((SECTION_ALIASES[section] ?? section) as SettingsSection)
  return item ? { id: item.id, meta: toSettingsHeaderMeta(item) } : null
}

/**
 * Title + description for a settings section, the single source of truth used by
 * `SettingsPanel` to render the page header. Falls back to `null` for sections
 * that are gated off (callers render no title in that case).
 */
export function getSettingsSectionMeta(
  section: SettingsSection
): { label: string; description: string; docsLink?: string } | null {
  const item = navigationItemsById.get(section)
  return item ? { label: item.label, description: item.description, docsLink: item.docsLink } : null
}
