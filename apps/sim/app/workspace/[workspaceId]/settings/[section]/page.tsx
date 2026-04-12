import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import { prefetchGeneralSettings, prefetchSubscriptionData, prefetchUserProfile } from './prefetch'
import { SettingsPage } from './settings'

const SECTION_TITLES: Record<string, string> = {
  general: 'General',
  integrations: 'Integrations',
  secrets: 'Secrets',
  'template-profile': 'Template Profile',
  'access-control': 'Access Control',
  'audit-logs': 'Audit Logs',
  apikeys: 'Sim Keys',
  byok: 'BYOK',
  subscription: 'Subscription',
  team: 'Team',
  sso: 'Single Sign-On',
  whitelabeling: 'Whitelabeling',
  copilot: 'Copilot Keys',
  mcp: 'MCP Tools',
  'custom-tools': 'Custom Tools',
  skills: 'Skills',
  'workflow-mcp-servers': 'MCP Servers',
  'credential-sets': 'Email Polling',
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
  const { section } = await params
  const queryClient = getQueryClient()

  void prefetchGeneralSettings(queryClient)
  void prefetchUserProfile(queryClient)
  if (isBillingEnabled) void prefetchSubscriptionData(queryClient)

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SettingsPage section={section as SettingsSection} />
    </HydrationBoundary>
  )
}
