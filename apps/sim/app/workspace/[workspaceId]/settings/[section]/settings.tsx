'use client'

import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { useSession } from '@/lib/auth/auth-client'
import { cn } from '@/lib/core/utils/cn'
import { captureEvent } from '@/lib/posthog/client'
import { General } from '@/app/workspace/[workspaceId]/settings/components/general/general'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import {
  allNavigationItems,
  isBillingEnabled,
  isCredentialSetsEnabled,
} from '@/app/workspace/[workspaceId]/settings/navigation'

const Admin = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/admin/admin').then((m) => m.Admin)
)
const ApiKeys = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/api-keys/api-keys').then(
    (m) => m.ApiKeys
  )
)
const BYOK = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/byok/byok').then((m) => m.BYOK)
)
const Copilot = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/copilot/copilot').then((m) => m.Copilot)
)
const CredentialSets = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/credential-sets/credential-sets').then(
    (m) => m.CredentialSets
  )
)
const Secrets = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/secrets/secrets').then((m) => m.Secrets)
)
const CustomTools = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/custom-tools/custom-tools').then(
    (m) => m.CustomTools
  )
)
const Inbox = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/inbox/inbox').then((m) => m.Inbox)
)
const MCP = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/mcp/mcp').then((m) => m.MCP)
)
const Mothership = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/mothership/mothership').then(
    (m) => m.Mothership
  )
)
const RecentlyDeleted = dynamic(() =>
  import(
    '@/app/workspace/[workspaceId]/settings/components/recently-deleted/recently-deleted'
  ).then((m) => m.RecentlyDeleted)
)
const Subscription = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/subscription/subscription').then(
    (m) => m.Subscription
  )
)
const TeamManagement = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/team-management/team-management').then(
    (m) => m.TeamManagement
  )
)
const WorkflowMcpServers = dynamic(() =>
  import(
    '@/app/workspace/[workspaceId]/settings/components/workflow-mcp-servers/workflow-mcp-servers'
  ).then((m) => m.WorkflowMcpServers)
)
const AccessControl = dynamic(() =>
  import('@/ee/access-control/components/access-control').then((m) => m.AccessControl)
)
const AuditLogs = dynamic(() =>
  import('@/ee/audit-logs/components/audit-logs').then((m) => m.AuditLogs)
)
const SSO = dynamic(() => import('@/ee/sso/components/sso-settings').then((m) => m.SSO))
const DataRetentionSettings = dynamic(() =>
  import('@/ee/data-retention/components/data-retention-settings').then(
    (m) => m.DataRetentionSettings
  )
)
const DataDrainsSettings = dynamic(() =>
  import('@/ee/data-drains/components/data-drains-settings').then((m) => m.DataDrainsSettings)
)
const WhitelabelingSettings = dynamic(
  () =>
    import('@/ee/whitelabeling/components/whitelabeling-settings').then(
      (m) => m.WhitelabelingSettings
    ),
  { ssr: false }
)

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
    !isBillingEnabled && (section === 'subscription' || section === 'organization')
      ? 'general'
      : section === 'credential-sets' && !isCredentialSetsEnabled
        ? 'general'
        : section === 'admin' && !sessionLoading && !isAdminRole
          ? 'general'
          : section === 'mothership' && !sessionLoading && !isAdminRole
            ? 'general'
            : section

  const label =
    allNavigationItems.find((item) => item.id === effectiveSection)?.label ?? effectiveSection

  useEffect(() => {
    if (sessionLoading) return
    captureEvent(posthog, 'settings_tab_viewed', { section: effectiveSection })
  }, [effectiveSection, sessionLoading, posthog])

  return (
    <div
      className={cn(
        (effectiveSection === 'access-control' || effectiveSection === 'recently-deleted') &&
          'flex h-full flex-col'
      )}
    >
      <h2 className='mb-7 font-medium text-[22px] text-[var(--text-primary)]'>{label}</h2>
      {effectiveSection === 'general' && <General />}
      {effectiveSection === 'secrets' && <Secrets />}
      {effectiveSection === 'credential-sets' && <CredentialSets />}
      {effectiveSection === 'access-control' && <AccessControl />}
      {effectiveSection === 'audit-logs' && <AuditLogs />}
      {effectiveSection === 'apikeys' && <ApiKeys />}
      {isBillingEnabled && effectiveSection === 'subscription' && <Subscription />}
      {isBillingEnabled && effectiveSection === 'organization' && <TeamManagement />}
      {effectiveSection === 'sso' && <SSO />}
      {effectiveSection === 'data-retention' && <DataRetentionSettings />}
      {effectiveSection === 'data-drains' && <DataDrainsSettings />}
      {effectiveSection === 'whitelabeling' && <WhitelabelingSettings />}
      {effectiveSection === 'byok' && <BYOK />}
      {effectiveSection === 'copilot' && <Copilot />}
      {effectiveSection === 'mcp' && <MCP initialServerId={mcpServerId} />}
      {effectiveSection === 'custom-tools' && <CustomTools />}
      {effectiveSection === 'workflow-mcp-servers' && <WorkflowMcpServers />}
      {effectiveSection === 'inbox' && <Inbox />}
      {effectiveSection === 'recently-deleted' && <RecentlyDeleted />}
      {effectiveSection === 'admin' && <Admin />}
      {effectiveSection === 'mothership' && <Mothership />}
    </div>
  )
}
