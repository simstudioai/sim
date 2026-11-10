import {
  ACCOUNT_SETTINGS_ITEMS,
  type AccountSettingsSection,
  ORGANIZATION_SETTINGS_GROUPS,
  ORGANIZATION_SETTINGS_ITEMS,
  type OrganizationSettingsFeatures,
  type OrganizationSettingsSection,
  type SettingsNavigationItem,
} from '@/components/settings/navigation'
import { organizationSupportsSettingsSection } from '@/lib/settings/section-availability'

/**
 * The account sections the organization surface hosts, rendered by the account
 * plane's own renderer. General is the one that belongs to the person alone: the
 * personal Subscription gives way to the organization's, which sits beside
 * General in the Account group. Platform administration keeps the account
 * plane's access rules; Desktop, Browser, and Terminal are workspace-bound.
 */
const ORGANIZATION_SURFACE_ACCOUNT_ITEMS: SettingsNavigationItem<AccountSettingsSection>[] =
  ACCOUNT_SETTINGS_ITEMS.filter((item) => item.id === 'general' || item.group === 'platform')

/**
 * Every section the organization surface's settings sidebar lists: the viewer's
 * account sections, then the organization sections the viewer's role and the
 * deployment allow. The sidebar groups them by {@link ORGANIZATION_SETTINGS_GROUPS},
 * so General leads the Account group and the organization's Subscription follows it.
 */
export function organizationSurfaceSettingsNavigation(
  isAdmin: boolean,
  features: OrganizationSettingsFeatures,
  availability: { connectedAccounts: boolean; search: boolean; knowledgeGraphs?: boolean },
  isPlatformAdmin: boolean
): SettingsNavigationItem<AccountSettingsSection | OrganizationSettingsSection>[] {
  return [
    ...ORGANIZATION_SURFACE_ACCOUNT_ITEMS.filter(
      (item) => item.group !== 'platform' || isPlatformAdmin
    ),
    ...ORGANIZATION_SETTINGS_ITEMS.filter((item) =>
      organizationSupportsSettingsSection(item.id, features, availability, isAdmin)
    ),
  ]
}
