import {
  buildUnifiedSettingsNavigation,
  SETTINGS_NAVIGATION_BILLING_ENABLED,
  type UnifiedNavigationSection,
  type UnifiedSettingsNavigationItem,
  type UnifiedSettingsSection,
} from '@/components/settings/navigation'

export type SettingsSection = UnifiedSettingsSection

export type NavigationSection = UnifiedNavigationSection

export type NavigationItem = UnifiedSettingsNavigationItem

export const isBillingEnabled = SETTINGS_NAVIGATION_BILLING_ENABLED

export const sectionConfig: { key: NavigationSection; title: string }[] = [
  { key: 'account', title: 'Account' },
  { key: 'tools', title: 'Tools' },
  { key: 'subscription', title: 'Subscription' },
  { key: 'system', title: 'System' },
  { key: 'enterprise', title: 'Enterprise' },
  { key: 'superuser', title: 'Superuser' },
]

export const allNavigationItems: NavigationItem[] = buildUnifiedSettingsNavigation()

/**
 * Title + description for a settings section, the single source of truth used by
 * `SettingsPanel` to render the page header. Falls back to `null` for sections
 * that are gated off (callers render no title in that case).
 */
export function getSettingsSectionMeta(
  section: SettingsSection
): { label: string; description: string; docsLink?: string } | null {
  const item = allNavigationItems.find((navItem) => navItem.id === section)
  return item ? { label: item.label, description: item.description, docsLink: item.docsLink } : null
}
