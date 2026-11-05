import type { SettingsNavGroup, SettingsSectionKey } from '@/platform/lib/data/settings-navigation'

interface SettingsSearchEntry {
  /** The row's label on its section. It also finds the row on the page once the section opens. */
  label: string
  /** Other words people use for it. */
  terms?: string
  /** Opens the section on this view, for a setting that lives behind a tab or a subview. */
  query?: string
  /** Shown only to whom the section renders it. */
  requires?: 'admin' | 'hosted'
}

/**
 * The settings a person looks for, per section. The rail filters by the viewer's own sections, so an
 * entry here reveals nothing the rail would not list.
 */
const SETTINGS_SEARCH_INDEX: Partial<Record<SettingsSectionKey, readonly SettingsSearchEntry[]>> = {
  general: [
    { label: 'Picture', terms: 'avatar photo profile image' },
    { label: 'Name', terms: 'display name profile' },
    { label: 'Email', terms: 'address profile' },
    { label: 'Theme', terms: 'appearance dark light mode system' },
    { label: 'Time zone', terms: 'timezone clock' },
    { label: 'Auto-connect on drop', terms: 'canvas workflow editor' },
    { label: 'Auto-focus on click', terms: 'canvas workflow editor' },
    { label: 'Snap to grid', terms: 'canvas workflow editor' },
    { label: 'Show canvas controls', terms: 'canvas workflow editor toolbar' },
    { label: 'Canvas error notifications', terms: 'alerts toast errors' },
    { label: 'Home page', terms: 'marketing website', requires: 'hosted' },
    { label: 'Sign out', terms: 'log out logout' },
    { label: 'Reset password', terms: 'change password credentials' },
    {
      label: 'Privacy',
      terms: 'telemetry cookies consent tracking analytics',
      query: 'view=privacy',
    },
    { label: 'Authorized apps', terms: 'oauth revoke access', query: 'view=authorized-apps' },
    {
      label: 'Connected organization accounts',
      terms: 'disconnect left organization',
      query: 'view=organization-accounts',
    },
    { label: 'Delete account', terms: 'remove close account' },
  ],
  billing: [
    { label: 'Subscription', terms: 'plan upgrade cancel renew team enterprise' },
    { label: 'Usage limit', terms: 'credits spend cap budget' },
    { label: 'Enable on-demand usage', terms: 'overage credits' },
    { label: 'Payment method', terms: 'card stripe portal' },
    { label: 'Invoices', terms: 'receipts billing history' },
  ],
  'knowledge-graphs': [
    { label: 'Graphs', terms: 'memory spaces active' },
    { label: 'New knowledge graph', terms: 'create memory space' },
  ],
  members: [
    { label: 'Members', terms: 'people roster users team roles permissions' },
    { label: 'Seats', terms: 'licenses plan capacity', requires: 'admin' },
    { label: 'Invite people', terms: 'add member invitation email', requires: 'admin' },
    { label: 'Organization membership', terms: 'leave organization' },
    { label: 'Transfer ownership', terms: 'owner leave', requires: 'admin' },
    { label: 'Manage credits', terms: 'member usage limit', requires: 'admin' },
  ],
  'connected-accounts': [
    { label: 'Credential Groups', terms: 'connected accounts shared oauth service accounts mcp' },
    { label: 'People', terms: 'members assigned group' },
    { label: 'Providers', terms: 'integrations apps' },
  ],
  usage: [
    { label: 'Period', terms: 'date range window insights' },
    { label: 'Export CSV', terms: 'download report' },
    { label: 'Credits', terms: 'spend cost models' },
    { label: 'Top models', terms: 'llm tokens' },
    { label: 'Top members', terms: 'people consumption' },
    { label: 'Workflow runs', terms: 'executions failures activity' },
    { label: 'Usage events', terms: 'ledger all events' },
  ],
  whitelabeling: [
    { label: 'Brand identity', terms: 'logo wordmark name custom branding' },
    { label: 'Colors', terms: 'primary accent theme branding' },
    { label: 'Links', terms: 'documentation terms privacy policy support email' },
  ],
  'recently-deleted': [{ label: 'Deleted chats', terms: 'restore trash undo' }],
  requests: [
    { label: 'My requests', terms: 'access pending withdraw' },
    { label: 'Browse access', terms: 'catalog request permission' },
    { label: 'Review requests', terms: 'approve decline', requires: 'admin' },
    { label: 'Allow requests', terms: 'pause access requests toggle', requires: 'admin' },
  ],
  'audit-logs': [
    { label: 'Audit events', terms: 'activity history compliance actions' },
    { label: 'Time range', terms: 'date filter' },
    { label: 'Resource type', terms: 'filter' },
    { label: 'Export CSV', terms: 'download report' },
  ],
  'access-control': [
    { label: 'Permission groups', terms: 'access control rbac policies roles allowlist' },
    { label: 'Organization default', terms: 'default group' },
    { label: 'Providers', terms: 'models llm allowlist' },
    { label: 'Agent default', terms: 'default model' },
    { label: 'Core Blocks', terms: 'tools allowlist' },
    { label: 'Integrations and Triggers', terms: 'blocks tools allowlist' },
    { label: 'Platform', terms: 'features deploy api keys restrictions' },
  ],
  sso: [
    { label: 'Identity providers', terms: 'saml oidc okta entra azure google login' },
    { label: 'Require single sign-on', terms: 'enforce mandatory sign-in requirement' },
    { label: 'Verified domains', terms: 'dns txt email domain', query: 'tab=domains' },
    { label: 'Directory provisioning', terms: 'scim users sync', query: 'tab=provisioning' },
    { label: 'Tokens', terms: 'scim bearer secret', query: 'tab=provisioning' },
    { label: 'Group mappings', terms: 'scim groups roles', query: 'tab=provisioning' },
  ],
  security: [
    { label: 'Session policies', terms: 'timeout lifetime idle duration' },
    { label: 'Sign out all members', terms: 'revoke sessions end all logout' },
    { label: 'Outbound IP addresses', terms: 'allowlist firewall egress static ip' },
  ],
  'data-retention': [
    { label: 'Retention', terms: 'logs soft delete tasks days purge' },
    { label: 'PII redaction', terms: 'personal data masking privacy patterns regex' },
    { label: 'Workspace override', terms: 'per workspace policy' },
  ],
  'data-drains': [
    { label: 'Data drains', terms: 'export s3 bigquery snowflake webhook siem destination' },
    { label: 'Schedule', terms: 'cadence daily hourly' },
    { label: 'Recent runs', terms: 'history manual export run now' },
  ],
  integrations: [
    { label: 'Sources', terms: 'integrations connectors slack github google drive search' },
    { label: 'Generic Secrets', terms: 'api key source' },
    { label: 'Live search', terms: 'policy federated' },
  ],
  'search-mcp': [
    { label: 'Server URL', terms: 'mcp model context protocol connection' },
    { label: 'Terminal command', terms: 'claude code cursor install' },
    { label: 'Configuration', terms: 'copy json' },
  ],
  'search-slack': [
    { label: 'Connection', terms: 'slack app bot workspace install set up' },
    { label: 'Managed users', terms: 'slack accounts' },
  ],
  admin: [{ label: 'Users', terms: 'platform admin ban impersonate super user' }],
  mothership: [{ label: 'Licenses', terms: 'platform admin byok environment overview' }],
}

interface SettingsSearchResult {
  /** Stable across renders of one section. */
  id: string
  label: string
  href: string
  /** The row to bring into view once the section opens. Absent for the section itself. */
  rowLabel?: string
}

export interface SettingsSearchGroup {
  key: SettingsSectionKey
  title: string
  icon: SettingsNavGroup['items'][number]['icon']
  results: SettingsSearchResult[]
}

interface SearchViewer {
  isAdmin: boolean
  hosted: boolean
}

function matches(words: readonly string[], ...text: readonly (string | undefined)[]) {
  const haystack = text.join(' ').toLowerCase()
  return words.every((word) => haystack.includes(word))
}

/**
 * Finds the viewer's sections and the settings inside them. A section that matches lists itself; a
 * setting that matches links to its row. Every word has to match, across label and synonyms.
 */
export function searchSettings(
  query: string,
  groups: readonly SettingsNavGroup[],
  viewer: SearchViewer
): SettingsSearchGroup[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return groups
    .flatMap((group) => group.items)
    .flatMap((item) => {
      const results: SettingsSearchResult[] = []
      if (matches(words, item.title, item.description)) {
        results.push({ id: item.key, label: item.title, href: item.href })
      }
      for (const entry of SETTINGS_SEARCH_INDEX[item.key] ?? []) {
        if (entry.requires === 'admin' && !viewer.isAdmin) continue
        if (entry.requires === 'hosted' && !viewer.hosted) continue
        if (entry.label === item.title && results.length > 0) continue
        if (matches(words, entry.label, entry.terms, item.title)) {
          results.push({
            id: `${item.key}:${entry.label}`,
            label: entry.label,
            href: entry.query ? `${item.href}?${entry.query}` : item.href,
            rowLabel: entry.label,
          })
        }
      }
      return results.length ? [{ key: item.key, title: item.title, icon: item.icon, results }] : []
    })
}

const ROW_WAIT_MS = 4_000

/**
 * Brings a setting's row into view when its section has rendered it, which may be a route and a
 * chunk away. A section still on its older page has no such row, and the wait simply lapses.
 */
export function revealSettingRow(label: string) {
  const selector = `[data-setting-label="${CSS.escape(label)}"]`
  const reveal = () => {
    const row = document.querySelector(selector)
    if (!row) return false
    row.scrollIntoView({ block: 'center' })
    return true
  }
  if (reveal()) return
  const observer = new MutationObserver(() => {
    if (reveal()) stop()
  })
  const timer = setTimeout(() => stop(), ROW_WAIT_MS)
  function stop() {
    observer.disconnect()
    clearTimeout(timer)
  }
  observer.observe(document.body, { childList: true, subtree: true })
}
