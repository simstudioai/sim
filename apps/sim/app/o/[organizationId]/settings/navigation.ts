import {
  ACCOUNT_SETTINGS_ITEMS,
  type AccountSettingsSection,
  isOrganizationSettingsSectionAvailable,
  ORGANIZATION_SETTINGS_GROUPS,
  ORGANIZATION_SETTINGS_ITEMS,
  type OrganizationSettingsFeatures,
  type OrganizationSettingsSection,
  parseSettingsPathSection,
  resolveOrganizationSectionAccess,
  type SettingsNavigationItem,
} from '@/components/settings/navigation'

/**
 * A section on the organization surface's settings, tagged with the plane that
 * renders it: the organization's own sections, or the viewer's account sections
 * hosted beside them so one settings surface serves the whole organization view.
 */
export type OrganizationSurfaceSettingsSection =
  | { plane: 'organization'; section: OrganizationSettingsSection }
  | { plane: 'account'; section: AccountSettingsSection }

/**
 * The account sections the organization surface hosts, rendered by the account
 * plane's own renderer. General is the one that belongs to the person alone: the
 * personal Subscription gives way to the organization's, which sits beside
 * General in the Account group, and the Desktop, Browser, and Terminal sections
 * are bound to the workspace they are opened from.
 */
export const ORGANIZATION_SURFACE_ACCOUNT_ITEMS: SettingsNavigationItem<AccountSettingsSection>[] =
  ACCOUNT_SETTINGS_ITEMS.filter((item) => item.id === 'general')

export function resolveOrganizationSettingsSection(
  path: string
): OrganizationSettingsSection | null {
  return parseSettingsPathSection<OrganizationSettingsSection, null>({
    path,
    items: ORGANIZATION_SETTINGS_ITEMS,
    defaultSection: null,
    aliases: { organization: 'members', team: 'members', subscription: 'billing', domains: 'sso' },
  })
}

/**
 * Resolves a settings path on the organization surface to the plane that owns
 * it. Organization sections win, so `billing` is the organization's Subscription.
 */
export function resolveOrganizationSurfaceSection(
  path: string
): OrganizationSurfaceSettingsSection | null {
  const organization = resolveOrganizationSettingsSection(path)
  if (organization) return { plane: 'organization', section: organization }
  const account = parseSettingsPathSection<AccountSettingsSection, null>({
    path,
    items: ORGANIZATION_SURFACE_ACCOUNT_ITEMS,
    defaultSection: null,
  })
  return account ? { plane: 'account', section: account } : null
}

export function organizationSettingsNavigation(
  isAdmin: boolean,
  features: OrganizationSettingsFeatures,
  availability: { connectedAccounts: boolean; search: boolean }
) {
  return ORGANIZATION_SETTINGS_ITEMS.filter(
    (item) =>
      (item.id !== 'connected-accounts' ||
        (availability.connectedAccounts && !availability.search)) &&
      ((item.id !== 'search-mcp' && item.id !== 'integrations') || availability.search) &&
      resolveOrganizationSectionAccess({
        section: item.id,
        isTargetOrganizationMember: true,
        isTargetOrganizationAdmin: isAdmin,
      }) !== 'unavailable' &&
      isOrganizationSettingsSectionAvailable(item.id, features)
  )
}

/**
 * Every section the organization surface's settings sidebar lists: the viewer's
 * account sections, then the organization sections the viewer's role and the
 * deployment allow. The sidebar groups them by {@link ORGANIZATION_SETTINGS_GROUPS},
 * so General leads the Account group and the organization's Subscription follows it.
 */
export function organizationSurfaceSettingsNavigation(
  isAdmin: boolean,
  features: OrganizationSettingsFeatures,
  availability: { connectedAccounts: boolean; search: boolean }
): SettingsNavigationItem<AccountSettingsSection | OrganizationSettingsSection>[] {
  return [
    ...ORGANIZATION_SURFACE_ACCOUNT_ITEMS,
    ...organizationSettingsNavigation(isAdmin, features, availability),
  ]
}
