import { organizationSupportsSettingsSection } from '@/lib/settings/section-availability'
import type { SettingsNavGroup, SettingsNavItem } from '@/platform/app/(shell)/_components/model'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'

/** The order and labels of the organization Settings sidebar; the surface owns visibility. */
const LIVE_SETTINGS = [
  {
    label: 'Account',
    items: [
      { key: 'general', title: 'General', icon: 'I116' },
      { key: 'billing', title: 'Subscription', icon: 'I138' },
      { key: 'knowledge-graphs', title: 'Knowledge graphs', icon: 'I004' },
    ],
  },
  {
    label: 'Organization',
    items: [
      { key: 'members', title: 'Members', icon: 'I139' },
      { key: 'connected-accounts', title: 'Credential Groups', icon: 'I070' },
      { key: 'usage', title: 'Insights', icon: 'I135' },
      { key: 'whitelabeling', title: 'White-labeling', icon: 'I036' },
      { key: 'recently-deleted', title: 'Recently deleted', icon: 'I053' },
      { key: 'requests', title: 'Requests', icon: 'I073' },
    ],
  },
  {
    label: 'Governance',
    items: [
      { key: 'audit-logs', title: 'Audit logs', icon: 'I075' },
      { key: 'access-control', title: 'Permission groups', icon: 'I050' },
      { key: 'sso', title: 'Single sign-on', icon: 'I137' },
      { key: 'security', title: 'Security', icon: 'I136' },
      { key: 'data-retention', title: 'Data retention', icon: 'I004' },
      { key: 'data-drains', title: 'Data drains', icon: 'I117' },
    ],
  },
  {
    label: 'Sim Search',
    items: [
      { key: 'integrations', title: 'Sources', icon: 'I070' },
      { key: 'search-mcp', title: 'Search MCP', icon: 'I126' },
      { key: 'search-slack', title: 'Sim Search in Slack', icon: 'I123' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { key: 'admin', title: 'Admin', icon: 'I116' },
      { key: 'mothership', title: 'Mothership', icon: 'I128' },
    ],
  },
] as const satisfies readonly {
  label: string
  items: readonly SettingsNavItem[]
}[]

type LiveSetting = (typeof LIVE_SETTINGS)[number]['items'][number]

export type LiveSettingsKey = LiveSetting['key']

/** Preview surfaces derive the same entitlement and feature decisions as the organization sidebar. */
export function previewSettingsSections(
  organization: Omit<PlatformOrganization, 'settingsSections'>
) {
  const availability = {
    connectedAccounts: organization.connectedAccountsAvailable,
    search: organization.searchAccess.memberScoped,
    knowledgeGraphs: organization.featureFlags['mothership-memory-spaces'],
  }
  return LIVE_SETTINGS.flatMap((group): readonly LiveSetting[] => group.items)
    .map((item) => item.key)
    .filter((key) => {
      if (key === 'admin' || key === 'mothership') return organization.navFlags.platformAdmin
      return (
        key === 'general' ||
        organizationSupportsSettingsSection(
          key,
          organization.settingsFeatures,
          availability,
          organization.viewer.isAdmin
        )
      )
    })
}

function isVisible(entry: LiveSetting, organization: PlatformOrganization): boolean {
  const platformOnly = entry.key === 'admin' || entry.key === 'mothership'
  return (
    (!platformOnly || organization.navFlags.platformAdmin) &&
    organization.settingsSections.includes(entry.key)
  )
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
      })),
  })).filter((group) => group.items.length > 0)
}

/** The section at `key` when this viewer may see it and this app renders it. */
export function resolveLiveSetting(key: string, organization: PlatformOrganization) {
  if (key === 'keyboard-shortcuts') return { key, title: 'Keyboard shortcuts' } as const
  if (key === 'links' && organization.navFlags.simLinks) return { key, title: 'Links' } as const
  const entry = LIVE_SETTINGS.flatMap((group): readonly LiveSetting[] => group.items).find(
    (item) => item.key === key
  )
  return entry && isVisible(entry, organization) ? entry : null
}

/**
 * The tab title of a Settings path, the same as the legacy page's. Whether the viewer may open it is
 * the route's answer, and a title reveals nothing the navigation's labels do not.
 */
export function settingsPageTitle([key = 'general', segment]: readonly string[]): string {
  if (key === 'usage' && segment === 'events') return 'Usage events'
  if (key === 'integrations' && segment === 'secrets') return 'Generic Secrets'
  if (key === 'integrations' && segment === 'sources') return 'Search source'
  if (key === 'integrations' && segment === 'providers') return 'Integration'
  if (key === 'keyboard-shortcuts') return 'Keyboard shortcuts'
  if (key === 'links') return 'Links'
  return (
    LIVE_SETTINGS.flatMap((group): readonly LiveSetting[] => group.items).find(
      (item) => item.key === key
    )?.title ?? 'Settings'
  )
}
