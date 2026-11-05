import type { SettingsNavGroup, SettingsNavItem } from '@/platform/app/(shell)/_components/model'
import { legacyRoutes, type PlatformOrganization } from '@/platform/lib/data/organization-model'

export const SETTINGS_DESTINATIONS = [
  { key: 'preferences', title: 'Preferences', icon: 'I116' },
  { key: 'keyboard-shortcuts', title: 'Keyboard shortcuts', icon: 'I044' },
  { key: 'notifications', title: 'Notifications', icon: 'I106' },
  { key: 'connections', title: 'Connections', icon: 'I070' },
  { key: 'members', title: 'Members', icon: 'I104' },
] as const satisfies readonly SettingsNavItem[]

const always = () => true

/**
 * Live Settings in display order. An entry with no `visible` shows when the server lists its key in
 * `settingsSections`, so no legacy rule is restated here. `linkOut` sections stay on the legacy surface.
 */
const LIVE_SETTINGS = [
  {
    label: 'Personal',
    items: [
      { key: 'preferences', title: 'Preferences', icon: 'I116', visible: always },
      { key: 'notifications', title: 'Notifications', icon: 'I106', visible: always },
      { key: 'keyboard-shortcuts', title: 'Keyboard shortcuts', icon: 'I044', visible: always },
      { key: 'privacy', title: 'Privacy', icon: 'I072', visible: always },
      {
        key: 'account',
        title: 'Account',
        icon: 'I104',
        visible: (organization: PlatformOrganization) => !organization.navFlags.anonymous,
      },
      { key: 'knowledge-graphs', title: 'Knowledge graphs', icon: 'I079' },
      { key: 'recently-deleted', title: 'Recently deleted', icon: 'I061' },
    ],
  },
  {
    label: 'Organization',
    items: [
      { key: 'members', title: 'Members', icon: 'I104' },
      { key: 'billing', title: 'Subscription', icon: 'I051' },
      { key: 'usage', title: 'Insights', icon: 'I046' },
      { key: 'whitelabeling', title: 'White-labeling', icon: 'I036' },
      { key: 'requests', title: 'Requests', icon: 'I015' },
      {
        key: 'links',
        title: 'Links',
        icon: 'I041',
        visible: (organization: PlatformOrganization) => organization.navFlags.simLinks,
      },
    ],
  },
  {
    label: 'Governance',
    items: [
      { key: 'audit-logs', title: 'Audit logs', icon: 'I079' },
      { key: 'access-control', title: 'Permission groups', icon: 'I072' },
      { key: 'sso', title: 'Single sign-on', icon: 'I072' },
      { key: 'security', title: 'Security', icon: 'I072' },
      { key: 'data-retention', title: 'Data retention', icon: 'I015' },
      { key: 'data-drains', title: 'Data drains', icon: 'I117' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { key: 'admin', title: 'Admin', icon: 'I116', linkOut: true },
      { key: 'mothership', title: 'Mothership', icon: 'I116', linkOut: true },
    ],
  },
] as const satisfies readonly {
  label: string
  items: readonly (SettingsNavItem & {
    visible?: (organization: PlatformOrganization) => boolean
    linkOut?: true
  })[]
}[]

type LiveSetting = (typeof LIVE_SETTINGS)[number]['items'][number]

export type LiveSettingsKey = Exclude<LiveSetting, { linkOut: true }>['key']

function isVisible(entry: LiveSetting, organization: PlatformOrganization): boolean {
  return 'visible' in entry
    ? entry.visible(organization)
    : organization.settingsSections.includes(entry.key)
}

export function resolveSettingsNavigation(organization: PlatformOrganization): SettingsNavGroup[] {
  return LIVE_SETTINGS.map((group) => ({
    label: group.label,
    items: (group.items as readonly LiveSetting[])
      .filter((entry) => isVisible(entry, organization))
      .map((entry) => ({
        key: entry.key,
        title: entry.title,
        icon: entry.icon,
        ...('linkOut' in entry && { href: legacyRoutes(organization).settingsSection(entry.key) }),
      })),
  })).filter((group) => group.items.length > 0)
}

/** The section at `key` when this viewer may see it and this app renders it. */
export function resolveLiveSetting(key: string, organization: PlatformOrganization) {
  const entry = LIVE_SETTINGS.flatMap((group): readonly LiveSetting[] => group.items).find(
    (item) => item.key === key
  )
  return entry && !('linkOut' in entry) && isVisible(entry, organization) ? entry : null
}
