'use client'

import type { ComponentType } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { resolveOrganizationSurfaceHeaderMeta } from '@/app/o/[organizationId]/settings/navigation'
import type { PlatformSettingsSection } from '@/platform/app/(shell)/settings/_components/platform-sections'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import hostStyles from '@/platform/app/(shell)/settings/_components/settings-host.module.css'
import { SettingsScreen } from '@/platform/app/(shell)/settings/_components/settings-screen/settings-screen'
import { LoadingRows } from '@/platform/design-system/components'
import { Surface } from '@/platform/design-system/components/surface/surface'
import { useSettingRowReveal } from '@/platform/lib/data/settings-search'

/** A tab with its own guide, in the section's one Docs position. */
const TAB_DOCS: Partial<Record<PlatformSettingsSection, Readonly<Record<string, string>>>> = {
  sso: {
    domains: 'https://docs.sim.ai/platform/enterprise/verified-domains',
    provisioning: 'https://docs.sim.ai/platform/enterprise/scim',
  },
}

const loading = () => <LoadingRows label='Loading settings' />

/** One chunk per section, so opening Settings loads only the section on screen. */
const PLATFORM_SECTIONS: Record<PlatformSettingsSection, ComponentType<SettingsSectionProps>> = {
  members: dynamic(
    () =>
      import('@/platform/app/(shell)/settings/_components/sections/members/members-panel').then(
        (m) => m.MembersPanel
      ),
    { loading }
  ),
  'connected-accounts': dynamic(
    () =>
      import(
        '@/platform/app/(shell)/settings/_components/sections/connected-accounts/connected-accounts-section'
      ),
    { loading }
  ),
  general: dynamic(
    () => import('@/platform/app/(shell)/settings/_components/sections/general/general-section'),
    { loading }
  ),
  billing: dynamic(
    () =>
      import('@/platform/app/(shell)/settings/_components/sections/billing/billing-view').then(
        (m) => m.BillingView
      ),
    { loading }
  ),
  usage: dynamic(
    () => import('@/platform/app/(shell)/settings/_components/sections/usage/usage-section'),
    { loading }
  ),
  requests: dynamic(
    () => import('@/platform/app/(shell)/settings/_components/sections/requests/requests-section'),
    { loading }
  ),
  'recently-deleted': dynamic(
    () =>
      import(
        '@/platform/app/(shell)/settings/_components/sections/recently-deleted/recently-deleted-section'
      ),
    { loading }
  ),
  'knowledge-graphs': dynamic(
    () =>
      import(
        '@/platform/app/(shell)/settings/_components/sections/knowledge-graphs/knowledge-graphs-section'
      ),
    { loading }
  ),
  whitelabeling: dynamic(
    () =>
      import(
        '@/platform/app/(shell)/settings/_components/sections/whitelabeling/whitelabeling-section'
      ),
    { loading }
  ),
  'audit-logs': dynamic(
    () =>
      import('@/platform/app/(shell)/settings/_components/sections/audit-logs/audit-logs-section'),
    { loading }
  ),
  sso: dynamic(
    () => import('@/platform/app/(shell)/settings/_components/sections/sso/sso-section'),
    { loading }
  ),
  security: dynamic(
    () => import('@/platform/app/(shell)/settings/_components/sections/security/security-section'),
    { loading }
  ),
  'data-retention': dynamic(
    () =>
      import(
        '@/platform/app/(shell)/settings/_components/sections/data-retention/data-retention-section'
      ),
    { loading }
  ),
  'data-drains': dynamic(
    () =>
      import(
        '@/platform/app/(shell)/settings/_components/sections/data-drains/data-drains-section'
      ),
    { loading }
  ),
  integrations: dynamic(
    () =>
      import(
        '@/platform/app/(shell)/settings/_components/sections/integrations/integrations-section'
      ),
    { loading }
  ),
  'search-slack': dynamic(
    () =>
      import(
        '@/platform/app/(shell)/settings/_components/sections/search-slack/search-slack-section'
      ),
    { loading }
  ),
  admin: dynamic(
    () => import('@/platform/app/(shell)/settings/_components/sections/admin/admin-section'),
    { loading }
  ),
  mothership: dynamic(
    () =>
      import('@/platform/app/(shell)/settings/_components/sections/mothership/mothership-section'),
    { loading }
  ),
  'search-mcp': dynamic(
    () =>
      import('@/platform/app/(shell)/settings/_components/sections/search-mcp/search-mcp-section'),
    { loading }
  ),
  'access-control': dynamic(
    () =>
      import(
        '@/platform/app/(shell)/settings/_components/sections/access-control/access-control-section'
      ),
    { loading }
  ),
}

interface PlatformSettingsSectionHostProps {
  section: PlatformSettingsSection
  subpath?: readonly string[]
}

/** A Settings section on the design, in its own surface below the frame's breadcrumb. */
export function PlatformSettingsSectionHost({
  section,
  subpath = [],
}: PlatformSettingsSectionHostProps) {
  const organization = useOrganizationContext()
  const params = useSearchParams()
  const revealRoot = useSettingRowReveal<HTMLDivElement>()
  const meta = resolveOrganizationSurfaceHeaderMeta(section)
  const query: SettingsSectionProps['query'] = {}
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key)
    query[key] = values.length > 1 ? values : values[0]
  }
  const Section = PLATFORM_SECTIONS[section]
  return (
    <div ref={revealRoot} className={hostStyles.host}>
      <Surface canvas>
        <SettingsScreen
          title={meta?.title ?? 'Settings'}
          description={meta?.description}
          docsHref={TAB_DOCS[section]?.[params.get('tab') ?? ''] ?? meta?.docsLink}
        >
          <Section organization={organization} subpath={subpath} query={query} />
        </SettingsScreen>
      </Surface>
    </div>
  )
}
