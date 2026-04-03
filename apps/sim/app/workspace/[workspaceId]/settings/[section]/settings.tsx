'use client'

import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { Skeleton } from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { captureEvent } from '@/lib/posthog/client'
import { AdminSkeleton } from '@/app/workspace/[workspaceId]/settings/components/admin/admin-skeleton'
import { ApiKeysSkeleton } from '@/app/workspace/[workspaceId]/settings/components/api-keys/api-key-skeleton'
import { BYOKSkeleton } from '@/app/workspace/[workspaceId]/settings/components/byok/byok-skeleton'
import { CopilotSkeleton } from '@/app/workspace/[workspaceId]/settings/components/copilot/copilot-skeleton'
import { CredentialSetsSkeleton } from '@/app/workspace/[workspaceId]/settings/components/credential-sets/credential-sets-skeleton'
import { CredentialsSkeleton } from '@/app/workspace/[workspaceId]/settings/components/credentials/credential-skeleton'
import { CustomToolsSkeleton } from '@/app/workspace/[workspaceId]/settings/components/custom-tools/custom-tool-skeleton'
import { GeneralSkeleton } from '@/app/workspace/[workspaceId]/settings/components/general/general-skeleton'
import { InboxSkeleton } from '@/app/workspace/[workspaceId]/settings/components/inbox/inbox-skeleton'
import { McpSkeleton } from '@/app/workspace/[workspaceId]/settings/components/mcp/mcp-skeleton'
import { SkillsSkeleton } from '@/app/workspace/[workspaceId]/settings/components/skills/skill-skeleton'
import { WorkflowMcpServersSkeleton } from '@/app/workspace/[workspaceId]/settings/components/workflow-mcp-servers/workflow-mcp-servers-skeleton'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import {
  allNavigationItems,
  isBillingEnabled,
  isCredentialSetsEnabled,
} from '@/app/workspace/[workspaceId]/settings/navigation'

/**
 * Generic skeleton fallback for sections without a dedicated skeleton.
 */
function SettingsSectionSkeleton() {
  return (
    <div className='flex flex-col gap-4'>
      <Skeleton className='h-[20px] w-[200px] rounded-sm' />
      <Skeleton className='h-[40px] w-full rounded-lg' />
      <Skeleton className='h-[40px] w-full rounded-lg' />
      <Skeleton className='h-[40px] w-full rounded-lg' />
    </div>
  )
}

const General = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/general/general').then(
      (m) => m.General
    ),
  { loading: () => <GeneralSkeleton /> }
)
const Integrations = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/integrations/integrations').then(
      (m) => m.Integrations
    ),
  { loading: () => <CredentialsSkeleton /> }
)
const Credentials = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/credentials/credentials').then(
      (m) => m.Credentials
    ),
  { loading: () => <CredentialsSkeleton /> }
)
// const TemplateProfile = dynamic(
//   () =>
//     import(
//       '@/app/workspace/[workspaceId]/settings/components/template-profile/template-profile'
//     ).then((m) => m.TemplateProfile),
//   { loading: () => <SettingsSectionSkeleton /> }
// )
const CredentialSets = dynamic(
  () =>
    import(
      '@/app/workspace/[workspaceId]/settings/components/credential-sets/credential-sets'
    ).then((m) => m.CredentialSets),
  { loading: () => <CredentialSetsSkeleton /> }
)
const ApiKeys = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/api-keys/api-keys').then(
      (m) => m.ApiKeys
    ),
  { loading: () => <ApiKeysSkeleton /> }
)
const Subscription = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/subscription/subscription').then(
      (m) => m.Subscription
    ),
  { loading: () => <SettingsSectionSkeleton /> }
)
const TeamManagement = dynamic(
  () =>
    import(
      '@/app/workspace/[workspaceId]/settings/components/team-management/team-management'
    ).then((m) => m.TeamManagement),
  { loading: () => <SettingsSectionSkeleton /> }
)
const BYOK = dynamic(
  () => import('@/app/workspace/[workspaceId]/settings/components/byok/byok').then((m) => m.BYOK),
  { loading: () => <BYOKSkeleton /> }
)
const Copilot = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/copilot/copilot').then(
      (m) => m.Copilot
    ),
  { loading: () => <CopilotSkeleton /> }
)
const MCP = dynamic(
  () => import('@/app/workspace/[workspaceId]/settings/components/mcp/mcp').then((m) => m.MCP),
  { loading: () => <McpSkeleton /> }
)
const CustomTools = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/custom-tools/custom-tools').then(
      (m) => m.CustomTools
    ),
  { loading: () => <CustomToolsSkeleton /> }
)
const Skills = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/skills/skills').then((m) => m.Skills),
  { loading: () => <SkillsSkeleton /> }
)
const WorkflowMcpServers = dynamic(
  () =>
    import(
      '@/app/workspace/[workspaceId]/settings/components/workflow-mcp-servers/workflow-mcp-servers'
    ).then((m) => m.WorkflowMcpServers),
  { loading: () => <WorkflowMcpServersSkeleton /> }
)
const Inbox = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/inbox/inbox').then((m) => m.Inbox),
  { loading: () => <InboxSkeleton /> }
)
const Admin = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/admin/admin').then((m) => m.Admin),
  { loading: () => <AdminSkeleton /> }
)
const RecentlyDeleted = dynamic(
  () =>
    import(
      '@/app/workspace/[workspaceId]/settings/components/recently-deleted/recently-deleted'
    ).then((m) => m.RecentlyDeleted),
  { loading: () => <SettingsSectionSkeleton /> }
)
const AccessControl = dynamic(
  () => import('@/ee/access-control/components/access-control').then((m) => m.AccessControl),
  { loading: () => <SettingsSectionSkeleton /> }
)
const SSO = dynamic(() => import('@/ee/sso/components/sso-settings').then((m) => m.SSO), {
  loading: () => <SettingsSectionSkeleton />,
})

interface SettingsPageProps {
  section: SettingsSection
}

export function SettingsPage({ section }: SettingsPageProps) {
  const searchParams = useSearchParams()
  const mcpServerId = searchParams.get('mcpServerId')
  const { data: session, isPending: sessionLoading } = useSession()
  const posthog = usePostHog()

  const isAdminRole = session?.user?.role === 'admin'
  const effectiveSection =
    !isBillingEnabled && (section === 'subscription' || section === 'team')
      ? 'general'
      : section === 'credential-sets' && !isCredentialSetsEnabled
        ? 'general'
        : section === 'admin' && !sessionLoading && !isAdminRole
          ? 'general'
          : section

  const label =
    allNavigationItems.find((item) => item.id === effectiveSection)?.label ?? effectiveSection

  useEffect(() => {
    if (sessionLoading) return
    captureEvent(posthog, 'settings_tab_viewed', { section: effectiveSection })
  }, [effectiveSection, sessionLoading, posthog])

  return (
    <div>
      <h2 className='mb-7 font-medium text-[22px] text-[var(--text-primary)]'>{label}</h2>
      {effectiveSection === 'general' && <General />}
      {effectiveSection === 'integrations' && <Integrations />}
      {effectiveSection === 'secrets' && <Credentials />}
      {/* {effectiveSection === 'template-profile' && <TemplateProfile />} */}
      {effectiveSection === 'credential-sets' && <CredentialSets />}
      {effectiveSection === 'access-control' && <AccessControl />}
      {effectiveSection === 'apikeys' && <ApiKeys />}
      {isBillingEnabled && effectiveSection === 'subscription' && <Subscription />}
      {isBillingEnabled && effectiveSection === 'team' && <TeamManagement />}
      {effectiveSection === 'sso' && <SSO />}
      {effectiveSection === 'byok' && <BYOK />}
      {effectiveSection === 'copilot' && <Copilot />}
      {effectiveSection === 'mcp' && <MCP initialServerId={mcpServerId} />}
      {effectiveSection === 'custom-tools' && <CustomTools />}
      {effectiveSection === 'skills' && <Skills />}
      {effectiveSection === 'workflow-mcp-servers' && <WorkflowMcpServers />}
      {effectiveSection === 'inbox' && <Inbox />}
      {effectiveSection === 'recently-deleted' && <RecentlyDeleted />}
      {effectiveSection === 'admin' && <Admin />}
    </div>
  )
}
