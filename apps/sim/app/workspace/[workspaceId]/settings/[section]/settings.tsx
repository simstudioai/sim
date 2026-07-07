'use client'

import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import { usePostHog } from 'posthog-js/react'
import { useSession } from '@/lib/auth/auth-client'
import { captureEvent } from '@/lib/posthog/client'
import { General } from '@/app/workspace/[workspaceId]/settings/components/general/general'
import { SettingsSectionProvider } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { useSettingsBeforeUnload } from '@/app/workspace/[workspaceId]/settings/hooks/use-settings-before-unload'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import {
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
const Billing = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/billing/billing').then((m) => m.Billing)
)
const Teammates = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/teammates/teammates').then(
    (m) => m.Teammates
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
const CustomBlocks = dynamic(() =>
  import('@/ee/custom-blocks/components/custom-blocks').then((m) => m.CustomBlocks)
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
  const { data: session, isPending: sessionLoading } = useSession()
  const posthog = usePostHog()

  useSettingsBeforeUnload()

  const isAdminRole = session?.user?.role === 'admin'
  const normalizedSection: SettingsSection =
    (section as string) === 'subscription' ? 'billing' : section
  const effectiveSection =
    !isBillingEnabled && (normalizedSection === 'billing' || normalizedSection === 'organization')
      ? 'general'
      : normalizedSection === 'credential-sets' && !isCredentialSetsEnabled
        ? 'general'
        : normalizedSection === 'admin' && !sessionLoading && !isAdminRole
          ? 'general'
          : normalizedSection === 'mothership' && !sessionLoading && !isAdminRole
            ? 'general'
            : normalizedSection

  useEffect(() => {
    if (sessionLoading) return
    captureEvent(posthog, 'settings_tab_viewed', { section: effectiveSection })
  }, [effectiveSection, sessionLoading, posthog])

  return (
    <SettingsSectionProvider section={effectiveSection}>
      {effectiveSection === 'general' && <General />}
      {effectiveSection === 'secrets' && <Secrets />}
      {effectiveSection === 'credential-sets' && <CredentialSets />}
      {effectiveSection === 'access-control' && <AccessControl />}
      {effectiveSection === 'custom-blocks' && <CustomBlocks />}
      {effectiveSection === 'audit-logs' && <AuditLogs />}
      {effectiveSection === 'apikeys' && <ApiKeys />}
      {isBillingEnabled && effectiveSection === 'billing' && <Billing />}
      {effectiveSection === 'teammates' && <Teammates />}
      {isBillingEnabled && effectiveSection === 'organization' && <TeamManagement />}
      {effectiveSection === 'sso' && <SSO />}
      {effectiveSection === 'data-retention' && <DataRetentionSettings />}
      {effectiveSection === 'data-drains' && <DataDrainsSettings />}
      {effectiveSection === 'whitelabeling' && <WhitelabelingSettings />}
      {effectiveSection === 'byok' && <BYOK />}
      {effectiveSection === 'copilot' && <Copilot />}
      {effectiveSection === 'mcp' && <MCP />}
      {effectiveSection === 'custom-tools' && <CustomTools />}
      {effectiveSection === 'workflow-mcp-servers' && <WorkflowMcpServers />}
      {effectiveSection === 'inbox' && <Inbox />}
      {effectiveSection === 'recently-deleted' && <RecentlyDeleted />}
      {effectiveSection === 'admin' && <Admin />}
      {effectiveSection === 'mothership' && <Mothership />}
    </SettingsSectionProvider>
  )
}
