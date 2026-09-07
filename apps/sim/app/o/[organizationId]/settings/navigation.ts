import {
  isOrganizationSettingsSectionAvailable,
  ORGANIZATION_SETTINGS_ITEMS,
  type OrganizationSettingsFeatures,
  type OrganizationSettingsSection,
  parseSettingsPathSection,
  resolveOrganizationSectionAccess,
} from '@/components/settings/navigation'

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

export function organizationSettingsNavigation(
  isAdmin: boolean,
  features: OrganizationSettingsFeatures
) {
  return ORGANIZATION_SETTINGS_ITEMS.filter(
    (item) =>
      resolveOrganizationSectionAccess({
        section: item.id,
        isTargetOrganizationMember: true,
        isTargetOrganizationAdmin: isAdmin,
      }) !== 'unavailable' && isOrganizationSettingsSectionAvailable(item.id, features)
  )
}
