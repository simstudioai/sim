import type { IconName } from '@sim/emcn/catalog/icon-geometry'

/** One setting a person looks for inside a Settings section. */
export interface SettingsSearchEntry {
  /** What a person searches for and sees in the results. */
  label: string
  /**
   * The rendered `SettingsRow` label or `SettingsSection` title to bring into view, on the view that
   * `query` opens. Absent when the setting is a control, tab, table or modal with no row of its own,
   * or lives on a page under the section: the result then opens the section, and no more.
   */
  row?: string
  /** Other words people use for it. */
  terms?: string
  /** Opens the section on this view, for a setting behind a tab or a subview. */
  query?: string
}

interface IndexedEntry extends SettingsSearchEntry {
  /** Listed only to whom the section renders it. */
  requires?: 'admin' | 'hosted'
}

/**
 * The settings a person looks for, per organization section, as the legacy Settings search indexed
 * them. The navigation lists only the viewer's sections, so an entry reveals nothing it would not.
 */
const SETTINGS_SEARCH_INDEX: Readonly<Record<string, readonly IndexedEntry[]>> = {
  general: [
    { label: 'Picture', row: 'Picture', terms: 'avatar photo profile image' },
    { label: 'Name', row: 'Name', terms: 'display name profile' },
    { label: 'Email', row: 'Email', terms: 'address profile' },
    { label: 'Theme', row: 'Theme', terms: 'appearance dark light mode system' },
    { label: 'Time zone', row: 'Time zone', terms: 'timezone clock' },
    { label: 'Auto-connect on drop', row: 'Auto-connect on drop', terms: 'canvas workflow editor' },
    { label: 'Auto-focus on click', row: 'Auto-focus on click', terms: 'canvas workflow editor' },
    { label: 'Snap to grid', row: 'Snap to grid', terms: 'canvas workflow editor' },
    {
      label: 'Show canvas controls',
      row: 'Show canvas controls',
      terms: 'canvas workflow editor toolbar',
    },
    {
      label: 'Canvas error notifications',
      row: 'Canvas error notifications',
      terms: 'alerts toast errors',
    },
    { label: 'Home page', row: 'Home page', terms: 'marketing website', requires: 'hosted' },
    { label: 'Sign out', row: 'Sign out', terms: 'log out logout' },
    { label: 'Reset password', row: 'Reset password', terms: 'change password credentials' },
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
    { label: 'Delete account', row: 'Delete account', terms: 'remove close account' },
  ],
  billing: [
    { label: 'Subscription', terms: 'plan upgrade cancel renew team enterprise' },
    { label: 'Usage limit', row: 'Usage limit', terms: 'credits spend cap budget' },
    { label: 'Enable on-demand usage', row: 'Enable on-demand usage', terms: 'overage credits' },
    { label: 'Payment method', row: 'Payment method', terms: 'card stripe portal' },
    { label: 'Invoices', row: 'Invoices', terms: 'receipts billing history' },
  ],
  'knowledge-graphs': [
    { label: 'Graphs', row: 'Graphs', terms: 'memory spaces active' },
    { label: 'New knowledge graph', terms: 'create memory space' },
  ],
  members: [
    { label: 'Members', terms: 'people roster users team roles permissions' },
    { label: 'Seats', row: 'Seats', terms: 'licenses plan capacity', requires: 'admin' },
    { label: 'Invite people', terms: 'add member invitation email', requires: 'admin' },
    {
      label: 'Organization membership',
      row: 'Organization membership',
      terms: 'leave organization',
    },
    { label: 'Transfer ownership', terms: 'owner leave', requires: 'admin' },
    { label: 'Manage credits', terms: 'member usage limit', requires: 'admin' },
  ],
  'connected-accounts': [
    { label: 'Credential groups', terms: 'connected accounts shared oauth service accounts mcp' },
    { label: 'People', row: 'People', terms: 'members assigned group', query: 'tab=people' },
    { label: 'Providers', row: 'Providers', terms: 'integrations apps' },
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
    { label: 'Brand identity', row: 'Brand identity', terms: 'logo wordmark name custom branding' },
    { label: 'Colors', row: 'Colors', terms: 'primary accent theme branding' },
    { label: 'Links', row: 'Links', terms: 'documentation terms privacy policy support email' },
  ],
  'recently-deleted': [{ label: 'Deleted chats', terms: 'restore trash undo' }],
  requests: [
    { label: 'My requests', terms: 'access pending withdraw', query: 'view=requests' },
    { label: 'Browse access', terms: 'catalog request permission', query: 'view=catalog' },
    { label: 'Review requests', terms: 'approve decline', query: 'view=review', requires: 'admin' },
    {
      label: 'Allow requests',
      row: 'Allow requests',
      terms: 'pause access requests toggle',
      query: 'view=review',
      requires: 'admin',
    },
  ],
  'audit-logs': [
    { label: 'Audit events', row: 'Audit events', terms: 'activity history compliance actions' },
    { label: 'Time range', terms: 'date filter' },
    { label: 'Resource type', terms: 'filter' },
    { label: 'Export CSV', terms: 'download report' },
  ],
  'access-control': [
    { label: 'Permission groups', terms: 'access control rbac policies roles allowlist' },
    { label: 'Organization default', terms: 'default group' },
    { label: 'Providers', terms: 'models llm allowlist' },
    { label: 'Agent default', terms: 'default model' },
    { label: 'Core blocks', terms: 'tools allowlist' },
    { label: 'Integrations and triggers', terms: 'blocks tools allowlist' },
    { label: 'Platform', terms: 'features deploy api keys restrictions' },
  ],
  sso: [
    {
      label: 'Identity providers',
      row: 'Identity providers',
      terms: 'saml oidc okta entra azure google login',
    },
    {
      label: 'Require single sign-on',
      row: 'Sign-in requirement',
      terms: 'enforce mandatory sign-in requirement',
    },
    {
      label: 'Verified domains',
      row: 'Verified domains',
      terms: 'dns txt email domain',
      query: 'tab=domains',
    },
    {
      label: 'Directory provisioning',
      row: 'Directory provisioning',
      terms: 'scim users sync',
      query: 'tab=provisioning',
    },
    { label: 'Tokens', row: 'Tokens', terms: 'scim bearer secret', query: 'tab=provisioning' },
    {
      label: 'Group mappings',
      row: 'Group mappings',
      terms: 'scim groups roles',
      query: 'tab=provisioning',
    },
  ],
  security: [
    { label: 'Session policies', row: 'Session policies', terms: 'timeout lifetime idle duration' },
    {
      label: 'Sign out all members',
      row: 'End all sessions',
      terms: 'revoke sessions end all logout',
    },
    {
      label: 'Outbound IP addresses',
      row: 'Outbound IP addresses',
      terms: 'allowlist firewall egress static ip',
    },
  ],
  'data-retention': [
    { label: 'Retention', row: 'Retention policies', terms: 'logs soft delete tasks days purge' },
    { label: 'PII redaction', terms: 'personal data masking privacy patterns regex' },
    { label: 'Workspace override', terms: 'per workspace policy' },
  ],
  'data-drains': [
    {
      label: 'Data drains',
      row: 'Data drains',
      terms: 'export s3 bigquery snowflake webhook siem destination',
    },
    { label: 'Schedule', terms: 'cadence daily hourly' },
    { label: 'Recent runs', terms: 'history manual export run now' },
  ],
  integrations: [
    {
      label: 'Sources',
      row: 'Search sources',
      terms: 'integrations connectors slack github google drive search',
    },
    { label: 'Generic Secrets', row: 'Generic Secrets', terms: 'api key source' },
    { label: 'Live search', terms: 'policy federated' },
  ],
  'search-mcp': [
    { label: 'Server URL', row: 'Connection', terms: 'mcp model context protocol connection' },
    { label: 'Terminal command', row: 'Connection', terms: 'claude code cursor install' },
    { label: 'Configuration', row: 'Configuration', terms: 'copy json' },
  ],
  'search-slack': [
    { label: 'Connection', row: 'Connection', terms: 'slack app bot workspace install set up' },
    { label: 'Managed users', terms: 'slack accounts' },
  ],
  admin: [
    { label: 'Users', row: 'User management', terms: 'platform admin ban impersonate super user' },
  ],
  mothership: [{ label: 'Licenses', terms: 'platform admin byok environment overview' }],
}

/** The URL key that names the row a search result brings into view on arrival. */
export const SETTING_ROW_PARAM = 'row'

/** A section's settings this viewer is shown, with the rows only admins or hosted sites render left out. */
export function settingsSearchEntries(
  section: string,
  viewer: { isAdmin: boolean; hosted: boolean }
): SettingsSearchEntry[] {
  return (SETTINGS_SEARCH_INDEX[section] ?? [])
    .filter(
      ({ requires }) =>
        (requires !== 'admin' || viewer.isAdmin) && (requires !== 'hosted' || viewer.hosted)
    )
    .map(({ requires, ...entry }) => entry)
}

interface SearchableSection {
  key: string
  title: string
  icon: IconName
  href: string
  search?: readonly SettingsSearchEntry[]
}

interface SettingsSearchGroup {
  key: string
  title: string
  icon: IconName
  results: { id: string; label: string; href: string }[]
}

function entryHref(sectionHref: string, entry: SettingsSearchEntry) {
  const [path, existing] = sectionHref.split('?')
  const params = new URLSearchParams(existing)
  for (const [name, value] of new URLSearchParams(entry.query)) params.set(name, value)
  if (entry.row) params.set(SETTING_ROW_PARAM, entry.row)
  return params.size ? `${path}?${params}` : path
}

function matches(words: readonly string[], ...text: readonly (string | undefined)[]) {
  const haystack = text.join(' ').toLowerCase()
  return words.every((word) => haystack.includes(word))
}

/**
 * Finds the sections and the settings inside them. A matching section lists itself; a matching
 * setting links to its row. Every word has to match, across the label, its synonyms and its section.
 */
export function searchSettings(
  query: string,
  sections: readonly SearchableSection[]
): SettingsSearchGroup[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return sections.flatMap((section) => {
    const results: SettingsSearchGroup['results'] = []
    if (matches(words, section.title))
      results.push({ id: section.key, label: section.title, href: section.href })
    for (const entry of section.search ?? []) {
      if (entry.label === section.title && results.length > 0) continue
      if (matches(words, entry.label, entry.terms, section.title))
        results.push({
          id: `${section.key}:${entry.label}`,
          label: entry.label,
          href: entryHref(section.href, entry),
        })
    }
    return results.length
      ? [{ key: section.key, title: section.title, icon: section.icon, results }]
      : []
  })
}
