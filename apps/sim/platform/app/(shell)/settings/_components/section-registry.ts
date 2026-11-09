import type { ComponentType } from 'react'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import type { LiveSettingsKey } from '@/platform/lib/data/settings-navigation'

/**
 * What a section receives. Its gate has already passed; its own API calls enforce the same rule.
 */
export interface SettingsSectionProps {
  fixture?: true
  organization: PlatformOrganization
  /** Segments after the section's key, limited to its declared `subpaths`. */
  subpath: readonly string[]
  query: Record<string, string | string[] | undefined>
}

interface SettingsSectionEntry {
  load: () => Promise<{ default: ComponentType<SettingsSectionProps> }>
  subpaths?: readonly string[]
}

/**
 * One lazily loaded folder per live section, so a section's owner edits only that folder. The
 * `Record` makes a section missing from either side of this map and its navigation entry a
 * compile error. Navigation and gates live in `lib/data/settings-navigation.ts`.
 */
export const SETTINGS_SECTIONS: Record<
  LiveSettingsKey | 'keyboard-shortcuts' | 'links',
  SettingsSectionEntry
> = {
  'connected-accounts': {
    load: () =>
      import(
        '@/platform/app/(shell)/settings/_components/sections/connected-accounts/connected-accounts-section'
      ),
  },
  integrations: {
    subpaths: ['secrets', 'providers/:connectorType', 'sources/:connectorId'],
    load: () =>
      import(
        '@/platform/app/(shell)/settings/_components/sections/integrations/integrations-section'
      ),
  },
  'search-mcp': {
    load: () =>
      import('@/platform/app/(shell)/settings/_components/sections/search-mcp/search-mcp-section'),
  },
  'search-slack': {
    load: () =>
      import(
        '@/platform/app/(shell)/settings/_components/sections/search-slack/search-slack-section'
      ),
  },
  'keyboard-shortcuts': {
    load: () =>
      import(
        '@/platform/app/(shell)/settings/_components/sections/keyboard-shortcuts/keyboard-shortcuts-section'
      ),
  },
  links: {
    load: () => import('@/platform/app/(shell)/settings/_components/sections/links/links-section'),
  },
  admin: {
    load: () => import('@/platform/app/(shell)/settings/_components/sections/admin/admin-section'),
  },
  mothership: {
    load: () =>
      import('@/platform/app/(shell)/settings/_components/sections/mothership/mothership-section'),
  },
  general: {
    load: () =>
      import('@/platform/app/(shell)/settings/_components/sections/general/general-section'),
  },
  'knowledge-graphs': {
    load: () =>
      import(
        '@/platform/app/(shell)/settings/_components/sections/knowledge-graphs/knowledge-graphs-section'
      ),
  },
  'recently-deleted': {
    load: () =>
      import(
        '@/platform/app/(shell)/settings/_components/sections/recently-deleted/recently-deleted-section'
      ),
  },
  members: {
    load: () =>
      import('@/platform/app/(shell)/settings/_components/sections/members/members-section'),
  },
  billing: {
    load: () =>
      import('@/platform/app/(shell)/settings/_components/sections/billing/billing-section'),
    subpaths: ['credit-usage'],
  },
  desktop: {
    load: () =>
      import('@/platform/app/(shell)/settings/_components/sections/desktop/desktop-section'),
  },
  browser: {
    load: () =>
      import('@/platform/app/(shell)/settings/_components/sections/browser/browser-section'),
  },
  terminal: {
    load: () =>
      import('@/platform/app/(shell)/settings/_components/sections/terminal/terminal-section'),
  },
  'self-host': {
    load: () =>
      import('@/platform/app/(shell)/settings/_components/sections/self-host/self-host-section'),
  },
  usage: {
    load: () => import('@/platform/app/(shell)/settings/_components/sections/usage/usage-section'),
    subpaths: ['events'],
  },
  whitelabeling: {
    load: () =>
      import(
        '@/platform/app/(shell)/settings/_components/sections/whitelabeling/whitelabeling-section'
      ),
  },
  requests: {
    load: () =>
      import('@/platform/app/(shell)/settings/_components/sections/requests/requests-section'),
  },
  'audit-logs': {
    load: () =>
      import('@/platform/app/(shell)/settings/_components/sections/audit-logs/audit-logs-section'),
  },
  'access-control': {
    load: () =>
      import(
        '@/platform/app/(shell)/settings/_components/sections/access-control/access-control-section'
      ),
  },
  sso: {
    load: () => import('@/platform/app/(shell)/settings/_components/sections/sso/sso-section'),
  },
  security: {
    load: () =>
      import('@/platform/app/(shell)/settings/_components/sections/security/security-section'),
  },
  'data-retention': {
    load: () =>
      import(
        '@/platform/app/(shell)/settings/_components/sections/data-retention/data-retention-section'
      ),
  },
  'data-drains': {
    load: () =>
      import(
        '@/platform/app/(shell)/settings/_components/sections/data-drains/data-drains-section'
      ),
  },
}
