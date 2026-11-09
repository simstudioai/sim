'use client'

import { type ComponentType, Suspense } from 'react'
import dynamic from 'next/dynamic'
import type {
  ClientSettingsSectionKey,
  SettingsSectionProps,
} from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'

/** Each browser-rendered section's code, loaded only when that section opens. */
const SECTIONS: Record<ClientSettingsSectionKey, ComponentType<SettingsSectionProps>> = {
  'search-mcp': dynamic(
    () =>
      import(
        '@/app/(product)/o/[organizationId]/settings/_components/sections/search-mcp/search-mcp-section'
      )
  ),
  'knowledge-graphs': dynamic(
    () =>
      import(
        '@/app/(product)/o/[organizationId]/settings/_components/sections/knowledge-graphs/knowledge-graphs-section'
      )
  ),
  'recently-deleted': dynamic(
    () =>
      import(
        '@/app/(product)/o/[organizationId]/settings/_components/sections/recently-deleted/recently-deleted-section'
      )
  ),
  desktop: dynamic(
    () =>
      import(
        '@/app/(product)/o/[organizationId]/settings/_components/sections/desktop/desktop-section'
      )
  ),
  browser: dynamic(
    () =>
      import(
        '@/app/(product)/o/[organizationId]/settings/_components/sections/browser/browser-section'
      )
  ),
  terminal: dynamic(
    () =>
      import(
        '@/app/(product)/o/[organizationId]/settings/_components/sections/terminal/terminal-section'
      )
  ),
  usage: dynamic(
    () =>
      import('@/app/(product)/o/[organizationId]/settings/_components/sections/usage/usage-section')
  ),
  whitelabeling: dynamic(
    () =>
      import(
        '@/app/(product)/o/[organizationId]/settings/_components/sections/whitelabeling/whitelabeling-section'
      )
  ),
  'audit-logs': dynamic(
    () =>
      import(
        '@/app/(product)/o/[organizationId]/settings/_components/sections/audit-logs/audit-logs-section'
      )
  ),
  'access-control': dynamic(
    () =>
      import(
        '@/app/(product)/o/[organizationId]/settings/_components/sections/access-control/access-control-section'
      )
  ),
  sso: dynamic(
    () => import('@/app/(product)/o/[organizationId]/settings/_components/sections/sso/sso-section')
  ),
  security: dynamic(
    () =>
      import(
        '@/app/(product)/o/[organizationId]/settings/_components/sections/security/security-section'
      )
  ),
  'data-retention': dynamic(
    () =>
      import(
        '@/app/(product)/o/[organizationId]/settings/_components/sections/data-retention/data-retention-section'
      )
  ),
  'data-drains': dynamic(
    () =>
      import(
        '@/app/(product)/o/[organizationId]/settings/_components/sections/data-drains/data-drains-section'
      )
  ),
}

interface OrganizationSettingsSectionProps extends SettingsSectionProps {
  section: ClientSettingsSectionKey
}

/** The open section's body. It paints nothing while its code loads, under the page's heading. */
export function OrganizationSettingsSection({
  section,
  fixture,
  organization,
  subpath,
  query,
}: OrganizationSettingsSectionProps) {
  const Section = SECTIONS[section]
  return (
    <Suspense fallback={null}>
      <Section fixture={fixture} organization={organization} subpath={subpath} query={query} />
    </Suspense>
  )
}
