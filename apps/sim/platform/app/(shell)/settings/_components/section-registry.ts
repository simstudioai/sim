import type { ComponentType } from 'react'
import type { LiveSettingsKey } from '@/platform/app/(shell)/_components/settings-navigation/destinations'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'

/**
 * What a section receives. Its gate has already passed; its own API calls enforce the same rule.
 */
export interface SettingsSectionProps {
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
 * compile error. Navigation and gates live in `settings-navigation/destinations.ts`.
 */
export const SETTINGS_SECTIONS: Record<LiveSettingsKey, SettingsSectionEntry> = {
  preferences: {
    load: () =>
      import(
        '@/platform/app/(shell)/settings/_components/sections/preferences/preferences-section'
      ),
  },
  notifications: {
    load: () =>
      import(
        '@/platform/app/(shell)/settings/_components/sections/notifications/notifications-section'
      ),
  },
  'keyboard-shortcuts': {
    load: () =>
      import(
        '@/platform/app/(shell)/settings/_components/sections/keyboard-shortcuts/keyboard-shortcuts-section'
      ),
  },
  privacy: {
    load: () =>
      import('@/platform/app/(shell)/settings/_components/sections/privacy/privacy-section'),
  },
  account: {
    load: () =>
      import('@/platform/app/(shell)/settings/_components/sections/account/account-section'),
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
  links: {
    load: () => import('@/platform/app/(shell)/settings/_components/sections/links/links-section'),
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
