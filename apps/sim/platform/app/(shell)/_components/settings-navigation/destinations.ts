import type { SettingsNavGroup, SettingsNavItem } from '@/platform/app/(shell)/_components/model'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import { legacyRoutes, type PlatformOrganization } from '@/platform/lib/data/organization-model'

interface SettingsDestination {
  key: string
  title: string
  icon: IconName
}

export const SETTINGS_DESTINATIONS = [
  { key: 'preferences', title: 'Preferences', icon: 'I116' },
  { key: 'keyboard-shortcuts', title: 'Keyboard shortcuts', icon: 'I044' },
  { key: 'notifications', title: 'Notifications', icon: 'I106' },
  { key: 'connections', title: 'Connections', icon: 'I070' },
  { key: 'members', title: 'Members', icon: 'I104' },
] as const satisfies readonly SettingsDestination[]

const legacySection = (section: string) => (organization: PlatformOrganization) =>
  organization.settingsSections.includes(section)
const always = () => true

/**
 * Live Settings in display order. A legacy section's gate is the server's own answer in
 * `settingsSections`, so no rule is restated here. `linkOut` sections stay on the legacy surface.
 */
const LIVE_SETTINGS = [
  { group: 'Personal', key: 'preferences', title: 'Preferences', icon: 'I116', visible: always },
  {
    group: 'Personal',
    key: 'notifications',
    title: 'Notifications',
    icon: 'I106',
    visible: always,
  },
  {
    group: 'Personal',
    key: 'keyboard-shortcuts',
    title: 'Keyboard shortcuts',
    icon: 'I044',
    visible: always,
  },
  { group: 'Personal', key: 'privacy', title: 'Privacy', icon: 'I072', visible: always },
  {
    group: 'Personal',
    key: 'account',
    title: 'Account',
    icon: 'I104',
    visible: (organization: PlatformOrganization) => !organization.navFlags.anonymous,
  },
  {
    group: 'Personal',
    key: 'knowledge-graphs',
    title: 'Knowledge graphs',
    icon: 'I079',
    visible: legacySection('knowledge-graphs'),
  },
  {
    group: 'Personal',
    key: 'recently-deleted',
    title: 'Recently deleted',
    icon: 'I061',
    visible: legacySection('recently-deleted'),
  },
  {
    group: 'Organization',
    key: 'members',
    title: 'Members',
    icon: 'I104',
    visible: legacySection('members'),
  },
  {
    group: 'Organization',
    key: 'billing',
    title: 'Subscription',
    icon: 'I051',
    visible: legacySection('billing'),
  },
  {
    group: 'Organization',
    key: 'usage',
    title: 'Insights',
    icon: 'I046',
    visible: legacySection('usage'),
  },
  {
    group: 'Organization',
    key: 'whitelabeling',
    title: 'White-labeling',
    icon: 'I036',
    visible: legacySection('whitelabeling'),
  },
  {
    group: 'Organization',
    key: 'requests',
    title: 'Requests',
    icon: 'I015',
    visible: legacySection('requests'),
  },
  {
    group: 'Organization',
    key: 'links',
    title: 'Links',
    icon: 'I041',
    visible: (organization: PlatformOrganization) => organization.navFlags.simLinks,
  },
  {
    group: 'Governance',
    key: 'audit-logs',
    title: 'Audit logs',
    icon: 'I079',
    visible: legacySection('audit-logs'),
  },
  {
    group: 'Governance',
    key: 'access-control',
    title: 'Permission groups',
    icon: 'I072',
    visible: legacySection('access-control'),
  },
  {
    group: 'Governance',
    key: 'sso',
    title: 'Single sign-on',
    icon: 'I072',
    visible: legacySection('sso'),
  },
  {
    group: 'Governance',
    key: 'security',
    title: 'Security',
    icon: 'I072',
    visible: legacySection('security'),
  },
  {
    group: 'Governance',
    key: 'data-retention',
    title: 'Data retention',
    icon: 'I015',
    visible: legacySection('data-retention'),
  },
  {
    group: 'Governance',
    key: 'data-drains',
    title: 'Data drains',
    icon: 'I117',
    visible: legacySection('data-drains'),
  },
  {
    group: 'Platform',
    key: 'admin',
    title: 'Admin',
    icon: 'I116',
    visible: legacySection('admin'),
    linkOut: true,
  },
  {
    group: 'Platform',
    key: 'mothership',
    title: 'Mothership',
    icon: 'I116',
    visible: legacySection('mothership'),
    linkOut: true,
  },
] as const satisfies readonly (SettingsDestination & {
  group: string
  visible: (organization: PlatformOrganization) => boolean
  linkOut?: true
})[]

type LiveSetting = (typeof LIVE_SETTINGS)[number]

/** A live section this app renders, as opposed to one that links out to the legacy surface. */
export type LiveSettingsKey = Exclude<LiveSetting, { linkOut: true }>['key']

function toNavItem(entry: LiveSetting, organization: PlatformOrganization): SettingsNavItem {
  return {
    key: entry.key,
    title: entry.title,
    icon: entry.icon,
    ...('linkOut' in entry && { href: legacyRoutes(organization).settingsSection(entry.key) }),
  }
}

/** The viewer's Settings navigation, computed on the server and handed to the shell as data. */
export function resolveSettingsNavigation(organization: PlatformOrganization): SettingsNavGroup[] {
  const groups = new Map<string, SettingsNavItem[]>()
  for (const entry of LIVE_SETTINGS) {
    if (!entry.visible(organization)) continue
    const items = groups.get(entry.group) ?? []
    items.push(toNavItem(entry, organization))
    groups.set(entry.group, items)
  }
  return [...groups].map(([label, items]) => ({ label, items }))
}

/** The section at `key` when this viewer may see it and this app renders it. */
export function resolveLiveSetting(key: string, organization: PlatformOrganization) {
  const entry = LIVE_SETTINGS.find((item) => item.key === key)
  return entry && !('linkOut' in entry) && entry.visible(organization) ? entry : null
}
