import { Suspense } from 'react'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import { prefetchGeneralSettings, prefetchSubscriptionData, prefetchUserProfile } from './prefetch'
import { SettingsPage } from './settings'

/**
 * Legacy settings sections that moved to top-level workspace routes.
 * Old bookmarks and emails deep-link here; without the redirect the
 * section renderer has no matching branch and shows an empty panel.
 */
const SETTINGS_REDIRECTS: Record<string, (workspaceId: string) => string> = {
  integrations: (id) => `/workspace/${id}/integrations`,
  skills: (id) => `/workspace/${id}/skills`,
}

const SECTION_TITLES: Record<string, string> = {
  general: 'General',
  secrets: 'Secrets',
  'access-control': 'Access Control',
  'audit-logs': 'Audit Logs',
  apikeys: 'Sim API Keys',
  byok: 'BYOK',
  subscription: 'Subscription',
  billing: 'Billing',
  teammates: 'Teammates',
  team: 'Team',
  sso: 'Single Sign-On',
  whitelabeling: 'Whitelabeling',
  copilot: 'Chat Keys',
  forks: 'Forks',
  mcp: 'MCP Tools',
  'custom-tools': 'Custom Tools',
  'workflow-mcp-servers': 'MCP Servers',
  'credential-sets': 'Email Polling',
  'data-retention': 'Data Retention',
  'recently-deleted': 'Recently Deleted',
  debug: 'Debug',
} as const

export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string }>
}): Promise<Metadata> {
  const { section } = await params
  return { title: SECTION_TITLES[section] ?? 'Settings' }
}

export default async function SettingsSectionPage({
  params,
}: {
  params: Promise<{ workspaceId: string; section: string }>
}) {
  const { workspaceId, section } = await params

  const redirectTo = SETTINGS_REDIRECTS[section]
  if (redirectTo) redirect(redirectTo(workspaceId))

  const queryClient = getQueryClient()

  void prefetchGeneralSettings(queryClient)
  void prefetchUserProfile(queryClient)
  if (isBillingEnabled) void prefetchSubscriptionData(queryClient)

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={null}>
        <SettingsPage section={section as SettingsSection} />
      </Suspense>
    </HydrationBoundary>
  )
}
