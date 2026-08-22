'use client'

import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import { usePostHog } from 'posthog-js/react'
import { SETTINGS_SECTION_LOADING_OPTIONS } from '@/components/settings/lazy-section'
import { useSession } from '@/lib/auth/auth-client'
import { captureEvent } from '@/lib/posthog/client'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { General } from '@/app/workspace/[workspaceId]/settings/components/general/general'
import { SettingsSectionProvider } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  getSettingsSectionMeta,
  isBillingEnabled,
  type SettingsSection,
} from '@/app/workspace/[workspaceId]/settings/navigation'

const Admin = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/admin/admin').then((m) => m.Admin),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const ApiKeys = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/api-keys/api-keys').then(
      (m) => m.ApiKeys
    ),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const BYOK = dynamic(
  () => import('@/app/workspace/[workspaceId]/settings/components/byok/byok').then((m) => m.BYOK),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const Forks = dynamic(
  () => import('@/ee/workspace-forking/components/forks').then((m) => m.Forks),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const Secrets = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/secrets/secrets').then(
      (m) => m.Secrets
    ),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const Sandboxes = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/sandboxes/sandboxes').then(
      (m) => m.Sandboxes
    ),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const CustomTools = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/custom-tools/custom-tools').then(
      (m) => m.CustomTools
    ),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const Inbox = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/inbox/inbox').then((m) => m.Inbox),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const MCP = dynamic(
  () => import('@/app/workspace/[workspaceId]/settings/components/mcp/mcp').then((m) => m.MCP),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const Mothership = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/mothership/mothership').then(
      (m) => m.Mothership
    ),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const RecentlyDeleted = dynamic(
  () =>
    import(
      '@/app/workspace/[workspaceId]/settings/components/recently-deleted/recently-deleted'
    ).then((m) => m.RecentlyDeleted),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const SelfHost = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/self-host/self-host').then(
      (m) => m.SelfHost
    ),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const Billing = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/billing/billing').then(
      (m) => m.Billing
    ),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const Teammates = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/teammates/teammates').then(
      (m) => m.Teammates
    ),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const TeamManagement = dynamic(
  () =>
    import(
      '@/app/workspace/[workspaceId]/settings/components/team-management/team-management'
    ).then((m) => m.TeamManagement),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const WorkflowMcpServers = dynamic(
  () =>
    import(
      '@/app/workspace/[workspaceId]/settings/components/workflow-mcp-servers/workflow-mcp-servers'
    ).then((m) => m.WorkflowMcpServers),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const AccessControl = dynamic(
  () => import('@/ee/access-control/components/access-control').then((m) => m.AccessControl),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const CustomBlocks = dynamic(
  () => import('@/ee/custom-blocks/components/custom-blocks').then((m) => m.CustomBlocks),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const CredentialGroups = dynamic(
  () => import('@/ee/credential-groups/components').then((m) => m.CredentialGroupsSettings),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const AuditLogs = dynamic(
  () => import('@/ee/audit-logs/components/audit-logs').then((m) => m.AuditLogs),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const SSO = dynamic(
  () => import('@/ee/sso/components/sso-settings').then((m) => m.SSO),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const SessionPolicySettings = dynamic(
  () =>
    import('@/ee/session-policy/components/session-policy-settings').then(
      (m) => m.SessionPolicySettings
    ),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const DataRetentionSettings = dynamic(
  () =>
    import('@/ee/data-retention/components/data-retention-settings').then(
      (m) => m.DataRetentionSettings
    ),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const DataDrainsSettings = dynamic(
  () =>
    import('@/ee/data-drains/components/data-drains-settings').then((m) => m.DataDrainsSettings),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const Desktop = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/desktop/desktop').then(
      (m) => m.Desktop
    ),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const Browser = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/browser/browser').then(
      (m) => m.Browser
    ),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const Terminal = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/terminal/terminal').then(
      (m) => m.Terminal
    ),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const WhitelabelingSettings = dynamic(
  () =>
    import('@/ee/whitelabeling/components/whitelabeling-settings').then(
      (m) => m.WhitelabelingSettings
    ),
  {
    ...SETTINGS_SECTION_LOADING_OPTIONS,
    ssr: false,
  }
)

interface SettingsPageProps {
  section: SettingsSection
}

export function SettingsPage({ section }: SettingsPageProps) {
  const { data: session, isPending: sessionLoading } = useSession()
  const hostContext = useWorkspaceHostContext()
  const posthog = usePostHog()

  const isAdminRole = session?.user?.role === 'admin'
  const normalizedSection: SettingsSection =
    (section as string) === 'subscription' ? 'billing' : section
  const effectiveSection =
    !isBillingEnabled && (normalizedSection === 'billing' || normalizedSection === 'organization')
      ? 'general'
      : normalizedSection === 'admin' && !sessionLoading && !isAdminRole
        ? 'general'
        : normalizedSection === 'mothership' && !sessionLoading && !isAdminRole
          ? 'general'
          : normalizedSection
  const organizationId = hostContext.hostOrganizationId
  const meta = getSettingsSectionMeta(effectiveSection)

  useEffect(() => {
    if (sessionLoading) return
    captureEvent(posthog, 'settings_tab_viewed', {
      plane: 'workspace',
      section: effectiveSection,
    })
  }, [effectiveSection, sessionLoading, posthog])

  return (
    <SettingsSectionProvider section={effectiveSection} meta={meta ?? undefined}>
      {effectiveSection === 'general' && <General />}
      {effectiveSection === 'desktop' && <Desktop />}
      {effectiveSection === 'browser' && <Browser />}
      {effectiveSection === 'terminal' && <Terminal />}
      {effectiveSection === 'secrets' && <Secrets />}
      {effectiveSection === 'credential-groups' && (
        <CredentialGroups workspaceId={hostContext.workspace.id} />
      )}
      {effectiveSection === 'access-control' && organizationId && (
        <AccessControl
          organizationId={organizationId}
          isOrganizationAdmin={hostContext.viewer.isHostOrganizationAdmin}
        />
      )}
      {effectiveSection === 'custom-blocks' && <CustomBlocks />}
      {effectiveSection === 'audit-logs' && organizationId && (
        <AuditLogs organizationId={organizationId} />
      )}
      {effectiveSection === 'apikeys' && <ApiKeys scope='combined' />}
      {isBillingEnabled && effectiveSection === 'billing' && (
        <Billing
          scope={organizationId ? 'organization' : 'account'}
          organizationId={organizationId ?? undefined}
          governingWorkspaceName={hostContext.workspace.name}
          creditUsageHref={`/workspace/${hostContext.workspace.id}/settings/billing/credit-usage`}
        />
      )}
      {effectiveSection === 'teammates' && <Teammates />}
      {isBillingEnabled && effectiveSection === 'organization' && organizationId && (
        <TeamManagement
          organizationId={organizationId}
          billingHref={`/workspace/${hostContext.workspace.id}/settings/billing`}
        />
      )}
      {effectiveSection === 'sso' && organizationId && <SSO organizationId={organizationId} />}
      {effectiveSection === 'sessions' && organizationId && (
        <SessionPolicySettings key={organizationId} organizationId={organizationId} />
      )}
      {effectiveSection === 'data-retention' && organizationId && (
        <DataRetentionSettings organizationId={organizationId} />
      )}
      {effectiveSection === 'data-drains' && organizationId && (
        <DataDrainsSettings organizationId={organizationId} />
      )}
      {effectiveSection === 'whitelabeling' && organizationId && (
        <WhitelabelingSettings organizationId={organizationId} />
      )}
      {effectiveSection === 'byok' && <BYOK />}
      {effectiveSection === 'sandboxes' && <Sandboxes />}
      {effectiveSection === 'mcp' && <MCP />}
      {effectiveSection === 'forks' && <Forks />}
      {effectiveSection === 'custom-tools' && <CustomTools />}
      {effectiveSection === 'workflow-mcp-servers' && <WorkflowMcpServers />}
      {effectiveSection === 'inbox' && <Inbox />}
      {effectiveSection === 'recently-deleted' && <RecentlyDeleted />}
      {effectiveSection === 'self-host' && <SelfHost />}
      {effectiveSection === 'admin' && <Admin />}
      {effectiveSection === 'mothership' && <Mothership />}
    </SettingsSectionProvider>
  )
}
