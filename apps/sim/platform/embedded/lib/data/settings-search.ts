'use client'

import { useEffect, useRef } from 'react'
import { parseAsString, useQueryState } from 'nuqs'
import type {
  SettingsNavGroup,
  SettingsSectionKey,
} from '@/platform/embedded/lib/data/settings-navigation'

interface SettingsSearchEntry {
  /** What a person searches for and sees in the results. */
  label: string
  /**
   * The rendered `SettingsRow` label or `SettingsSection` title to bring into view, on the section's
   * view that `query` opens. Absent when the setting is a control, tab, table or modal with no row of
   * its own, or lives on a page under the section: the result then opens the section, and no more.
   */
  row?: string
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
export const SETTINGS_SEARCH_INDEX: Partial<
  Record<SettingsSectionKey, readonly SettingsSearchEntry[]>
> = {
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
    { label: 'Credential Groups', terms: 'connected accounts shared oauth service accounts mcp' },
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
  'recently-deleted': [
    { label: 'Deleted chats', row: 'Deleted chats', terms: 'restore trash undo' },
  ],
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
    { label: 'Core Blocks', terms: 'tools allowlist' },
    { label: 'Integrations and Triggers', terms: 'blocks tools allowlist' },
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
      row: 'Added sources',
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

interface SettingsSearchResult {
  /** Stable across renders of one section. */
  id: string
  label: string
  href: string
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

const SETTING_ROW_PARAM = 'row'
const ROW_WAIT_MS = 4_000

/**
 * The row to bring into view, carried by the destination's own URL so it is read only once that
 * section has committed. Nullable with no default: it is a one-shot signal, stripped once answered.
 */
const settingRowParser = parseAsString.withOptions({ history: 'replace', scroll: false })

function entryHref(sectionHref: string, entry: SettingsSearchEntry) {
  const params = new URLSearchParams(entry.query)
  if (entry.row) params.set(SETTING_ROW_PARAM, entry.row)
  return params.size ? `${sectionHref}?${params}` : sectionHref
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
            href: entryHref(item.href, entry),
          })
        }
      }
      return results.length ? [{ key: item.key, title: item.title, icon: item.icon, results }] : []
    })
}

/**
 * Brings the URL's row into view inside the returned root once it has rendered, which may be a chunk
 * and a read away. A newer row or an unmount cancels the wait. The param is stripped when the row is
 * found or the wait lapses, because a row that loads conditionally may never come, and so that a
 * second click on the same result reveals it again.
 */
export function useSettingRowReveal<TRoot extends HTMLElement>() {
  const [row, setRow] = useQueryState(SETTING_ROW_PARAM, settingRowParser)
  const rootRef = useRef<TRoot>(null)
  useEffect(() => {
    const root = rootRef.current
    if (!row || !root) return
    const selector = `[data-setting-label="${CSS.escape(row)}"]`
    const settle = () => {
      stop()
      void setRow(null)
    }
    const reveal = () => {
      const element = root.querySelector(selector)
      if (!element) return
      element.scrollIntoView({ block: 'center' })
      settle()
    }
    const observer = new MutationObserver(reveal)
    const timer = setTimeout(settle, ROW_WAIT_MS)
    function stop() {
      observer.disconnect()
      clearTimeout(timer)
    }
    observer.observe(root, { childList: true, subtree: true })
    reveal()
    return stop
  }, [row, setRow])
  return rootRef
}
