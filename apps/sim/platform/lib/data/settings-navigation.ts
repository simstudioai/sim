import { organizationSupportsSettingsSection } from '@/lib/settings/section-availability'
import type { SettingsNavGroup, SettingsNavItem } from '@/platform/lib/data/models/shell'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { settingsSearchEntries } from '@/platform/shared/settings-search'

/**
 * The order, labels and page summaries of the organization Settings sidebar; the surface owns
 * visibility. A page's `description` is the line under its title.
 */
const LIVE_SETTINGS = [
  {
    label: 'Personal',
    items: [
      {
        key: 'general',
        title: 'Preferences',
        icon: 'I116',
        description: 'Manage your personal preferences',
      },
      {
        key: 'keyboard-shortcuts',
        title: 'Keyboard shortcuts',
        icon: 'I044',
        description: 'Move around Sim from the keyboard',
      },
      {
        key: 'billing',
        title: 'Subscription',
        icon: 'I138',
        description: 'Manage your plan, usage limit and invoices',
      },
      {
        key: 'desktop',
        title: 'Desktop',
        icon: 'I038',
        desktop: 'settings',
        description: 'Manage how the desktop app runs on this computer',
      },
      {
        key: 'browser',
        title: 'Browser',
        icon: 'I041',
        desktop: 'browser',
        description: 'Manage the built-in browser on this device',
      },
      {
        key: 'terminal',
        title: 'Terminal',
        icon: 'I107',
        desktop: 'terminal',
        description: 'Manage the built-in terminal on this device',
      },
      {
        key: 'knowledge-graphs',
        title: 'Knowledge graphs',
        icon: 'I004',
        description: 'Choose the graph your new chats remember',
      },
    ],
  },
  {
    label: 'Organization',
    items: [
      {
        key: 'members',
        title: 'Members',
        icon: 'I139',
        description: 'Invite people and manage their roles',
      },
      {
        key: 'connected-accounts',
        title: 'Credential groups',
        icon: 'I070',
        description: 'Pool the accounts your workspaces connect with',
      },
      {
        key: 'usage',
        title: 'Insights',
        icon: 'I135',
        description: 'See how your organization uses Sim',
      },
      {
        key: 'whitelabeling',
        title: 'White-labeling',
        icon: 'I036',
        description: 'Brand Sim for your organization',
      },
      {
        key: 'recently-deleted',
        title: 'Recently deleted',
        icon: 'I053',
        description: 'Restore deleted work before it is removed for good',
      },
      {
        key: 'requests',
        title: 'Requests',
        icon: 'I073',
        description: 'Review requests for access',
      },
      {
        key: 'links',
        title: 'Links',
        icon: 'I041',
        description: 'Manage your organization’s go links',
      },
    ],
  },
  {
    label: 'Governance',
    items: [
      {
        key: 'audit-logs',
        title: 'Audit logs',
        icon: 'I075',
        description: 'Review who changed what, and when',
      },
      {
        key: 'access-control',
        title: 'Permission groups',
        icon: 'I050',
        description: 'Control what members can use',
      },
      {
        key: 'sso',
        title: 'Single sign-on',
        icon: 'I137',
        description: 'Sign members in through your identity provider',
      },
      {
        key: 'security',
        title: 'Security',
        icon: 'I136',
        description: 'Manage sessions and sign-in policy',
      },
      {
        key: 'data-retention',
        title: 'Data retention',
        icon: 'I004',
        description: 'Choose how long Sim keeps your data',
      },
      {
        key: 'data-drains',
        title: 'Data drains',
        icon: 'I117',
        description: 'Export your data to your own storage on a schedule',
      },
    ],
  },
  {
    label: 'Sim Search',
    items: [
      {
        key: 'integrations',
        title: 'Sources',
        icon: 'I070',
        description: 'Connect the sources Sim Search reads',
      },
      {
        key: 'search-mcp',
        title: 'Search MCP',
        icon: 'I126',
        description: 'Use Sim Search from your AI tools',
      },
      {
        key: 'search-slack',
        title: 'Sim Search in Slack',
        icon: 'I123',
        description: 'Ask Sim Search questions in Slack',
      },
    ],
  },
  {
    label: 'Platform',
    items: [
      {
        key: 'admin',
        title: 'Admin',
        icon: 'I116',
        description: 'Manage users and workflows across Sim',
      },
      {
        key: 'mothership',
        title: 'Mothership',
        icon: 'I128',
        description: 'Manage Mothership environments and licenses',
      },
      {
        key: 'self-host',
        title: 'Self hosting',
        icon: 'I104',
        description: 'Connect this deployment to Sim’s hosted services',
      },
    ],
  },
] as const satisfies readonly {
  label: string
  items: readonly (SettingsNavItem & { description: string })[]
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
      // The desktop app's own settings and self-hosting sit outside the organization's gates, and
      // Links follows its rollout flag rather than a plan.
      if (
        key === 'keyboard-shortcuts' ||
        key === 'desktop' ||
        key === 'browser' ||
        key === 'terminal' ||
        key === 'self-host' ||
        key === 'links'
      )
        return false
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
  if ('desktop' in entry || entry.key === 'keyboard-shortcuts') return true
  if (entry.key === 'self-host') return !organization.deployment.hosted
  if (entry.key === 'links') return organization.navFlags.simLinks
  const platformOnly = entry.key === 'admin' || entry.key === 'mothership'
  return (
    (!platformOnly || organization.navFlags.platformAdmin) &&
    organization.settingsSections.includes(entry.key)
  )
}

export function resolveSettingsNavigation(organization: PlatformOrganization): SettingsNavGroup[] {
  const viewer = {
    isAdmin: organization.viewer.isAdmin,
    hosted: organization.deployment.hosted,
  }
  return LIVE_SETTINGS.map((group) => ({
    label: group.label,
    items: (group.items as readonly LiveSetting[])
      .filter((entry) => isVisible(entry, organization))
      .map((entry) => ({
        key: entry.key,
        title: entry.title,
        icon: entry.icon,
        search: settingsSearchEntries(entry.key, viewer),
        ...('desktop' in entry ? { desktop: entry.desktop } : {}),
      })),
  })).filter((group) => group.items.length > 0)
}

/** The section at `key` when this viewer may see it and this app renders it. */
export function resolveLiveSetting(key: string, organization: PlatformOrganization) {
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
  if (key === 'billing' && segment === 'credit-usage') return 'Credit usage'
  if (key === 'integrations' && segment === 'secrets') return 'Generic Secrets'
  if (key === 'integrations' && segment === 'sources') return 'Search source'
  if (key === 'integrations' && segment === 'providers') return 'Integration'
  return (
    LIVE_SETTINGS.flatMap((group): readonly LiveSetting[] => group.items).find(
      (item) => item.key === key
    )?.title ?? 'Settings'
  )
}
