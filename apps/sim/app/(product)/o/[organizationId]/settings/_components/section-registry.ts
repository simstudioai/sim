import type { ComponentType } from 'react'
import dynamic from 'next/dynamic'
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

type SettingsSectionKey = LiveSettingsKey

/** Sections that read or gate on the server before they render. */
type ServerSettingsSectionKey =
  | 'connected-accounts'
  | 'integrations'
  | 'search-slack'
  | 'keyboard-shortcuts'
  | 'links'
  | 'admin'
  | 'mothership'
  | 'general'
  | 'members'
  | 'billing'
  | 'self-host'
  | 'requests'

/** Sections that render only in the browser, loaded by `OrganizationSettingsSection`. */
export type ClientSettingsSectionKey = Exclude<SettingsSectionKey, ServerSettingsSectionKey>

interface SettingsSectionEntry {
  subpaths?: readonly string[]
  /** A server section's component; a client section loads in the browser instead. */
  Section?: ComponentType<SettingsSectionProps>
}

/**
 * One lazily loaded folder per live section, so a section's owner edits only that folder and a
 * section's code ships only where it opens. A server section loads through `next/dynamic` here,
 * which lazy-loads the client components it renders; a client section loads in the browser, since
 * a server component that imports a client component dynamically does not split it. The `Record`
 * makes a section missing from either side of this map and its navigation entry a compile error.
 * Navigation and gates live in `lib/data/settings-navigation.ts`.
 */
export const SETTINGS_SECTIONS: Record<SettingsSectionKey, SettingsSectionEntry> = {
  'connected-accounts': {
    Section: dynamic(
      () =>
        import(
          '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/connected-accounts-section'
        )
    ),
  },
  integrations: {
    subpaths: ['secrets', 'providers/:connectorType', 'sources/:connectorId'],
    Section: dynamic(
      () =>
        import(
          '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/integrations-section'
        )
    ),
  },
  'search-mcp': {},
  'search-slack': {
    Section: dynamic(
      () =>
        import(
          '@/app/(product)/o/[organizationId]/settings/_components/sections/search-slack/search-slack-section'
        )
    ),
  },
  'keyboard-shortcuts': {
    Section: dynamic(
      () =>
        import(
          '@/app/(product)/o/[organizationId]/settings/_components/sections/keyboard-shortcuts/keyboard-shortcuts-section'
        )
    ),
  },
  links: {
    Section: dynamic(
      () =>
        import(
          '@/app/(product)/o/[organizationId]/settings/_components/sections/links/links-section'
        )
    ),
  },
  admin: {
    Section: dynamic(
      () =>
        import(
          '@/app/(product)/o/[organizationId]/settings/_components/sections/admin/admin-section'
        )
    ),
  },
  mothership: {
    Section: dynamic(
      () =>
        import(
          '@/app/(product)/o/[organizationId]/settings/_components/sections/mothership/mothership-section'
        )
    ),
  },
  general: {
    Section: dynamic(
      () =>
        import(
          '@/app/(product)/o/[organizationId]/settings/_components/sections/general/general-section'
        )
    ),
  },
  'knowledge-graphs': {},
  'recently-deleted': {},
  members: {
    Section: dynamic(
      () =>
        import(
          '@/app/(product)/o/[organizationId]/settings/_components/sections/members/members-section'
        )
    ),
  },
  billing: {
    subpaths: ['credit-usage'],
    Section: dynamic(
      () =>
        import(
          '@/app/(product)/o/[organizationId]/settings/_components/sections/billing/billing-section'
        )
    ),
  },
  desktop: {},
  browser: {},
  terminal: {},
  'self-host': {
    Section: dynamic(
      () =>
        import(
          '@/app/(product)/o/[organizationId]/settings/_components/sections/self-host/self-host-section'
        )
    ),
  },
  usage: {
    subpaths: ['events'],
  },
  whitelabeling: {},
  requests: {
    Section: dynamic(
      () =>
        import(
          '@/app/(product)/o/[organizationId]/settings/_components/sections/requests/requests-section'
        )
    ),
  },
  'audit-logs': {},
  'access-control': {},
  sso: {},
  security: {},
  'data-retention': {},
  'data-drains': {},
}

/** Whether a section renders in the browser, where `OrganizationSettingsSection` loads it. */
export function isClientSettingsSection(key: SettingsSectionKey): key is ClientSettingsSectionKey {
  return !SETTINGS_SECTIONS[key].Section
}
