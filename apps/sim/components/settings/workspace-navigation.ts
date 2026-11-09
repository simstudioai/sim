import {
  buildUnifiedSettingsCatalog,
  type UnifiedSettingsNavigationItem,
  type UnifiedSettingsSection,
} from '@/components/settings/navigation'

export type SettingsSection = UnifiedSettingsSection

export type NavigationItem = UnifiedSettingsNavigationItem

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
