'use client'

import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import { usePostHog } from 'posthog-js/react'
import { getSettingsPermissionConfigKey } from '@/components/settings/navigation'
import { useSession } from '@/lib/auth/auth-client'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { captureEvent } from '@/lib/posthog/client'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { General } from '@/app/workspace/[workspaceId]/settings/components/general/general'
import { SettingsSectionProvider } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  getSettingsSectionMeta,
  type SettingsSection,
} from '@/app/workspace/[workspaceId]/settings/navigation'
import { SECTION_MODULES } from '@/app/workspace/[workspaceId]/settings/section-warmers'
import { PermissionAccessBoundary } from '@/ee/access-requests/components/permission-access-boundary'

const Admin = dynamic(() => SECTION_MODULES.admin().then((m) => m.Admin))
const ApiKeys = dynamic(() => SECTION_MODULES.apikeys().then((m) => m.ApiKeys))
const BYOK = dynamic(() => SECTION_MODULES.byok().then((m) => m.BYOK))
const Forks = dynamic(() => SECTION_MODULES.forks().then((m) => m.Forks))
const Secrets = dynamic(() => SECTION_MODULES.secrets().then((m) => m.Secrets))
const OrganizationConnectedAccounts = dynamic(() =>
  SECTION_MODULES['connected-accounts']().then((m) => m.OrganizationConnectedAccounts)
)
const Sandboxes = dynamic(() => SECTION_MODULES.sandboxes().then((m) => m.Sandboxes))
const CustomTools = dynamic(() => SECTION_MODULES['custom-tools']().then((m) => m.CustomTools))
const Inbox = dynamic(() => SECTION_MODULES.inbox().then((m) => m.Inbox))
const MCP = dynamic(() => SECTION_MODULES.mcp().then((m) => m.MCP))
const Mothership = dynamic(() => SECTION_MODULES.mothership().then((m) => m.Mothership))
const RecentlyDeleted = dynamic(() =>
  SECTION_MODULES['recently-deleted']().then((m) => m.RecentlyDeleted)
)
const SelfHost = dynamic(() => SECTION_MODULES['self-host']().then((m) => m.SelfHost))
const Billing = dynamic(() => SECTION_MODULES.billing().then((m) => m.Billing))
const Teammates = dynamic(() => SECTION_MODULES.teammates().then((m) => m.Teammates))
const TeamManagement = dynamic(() => SECTION_MODULES.organization().then((m) => m.TeamManagement))
const WorkflowMcpServers = dynamic(() =>
  SECTION_MODULES['workflow-mcp-servers']().then((m) => m.WorkflowMcpServers)
)
const AccessControl = dynamic(() =>
  SECTION_MODULES['access-control']().then((m) => m.AccessControl)
)
const AccessRequestsSettings = dynamic(() =>
  SECTION_MODULES.requests().then((m) => m.AccessRequestsSettings)
)
const CustomBlocks = dynamic(() => SECTION_MODULES['custom-blocks']().then((m) => m.CustomBlocks))
const AuditLogs = dynamic(() => SECTION_MODULES['audit-logs']().then((m) => m.AuditLogs))
const SSO = dynamic(() => SECTION_MODULES.sso().then((m) => m.SSO))
const DataRetentionSettings = dynamic(() =>
  SECTION_MODULES['data-retention']().then((m) => m.DataRetentionSettings)
)
const DataDrainsSettings = dynamic(() =>
  SECTION_MODULES['data-drains']().then((m) => m.DataDrainsSettings)
)
const OrganizationSecuritySettings = dynamic(() =>
  SECTION_MODULES.security().then((m) => m.OrganizationSecuritySettings)
)
const UsageMonitoring = dynamic(() => SECTION_MODULES.usage().then((m) => m.UsageMonitoring))
const Desktop = dynamic(() => SECTION_MODULES.desktop().then((m) => m.Desktop))
const Browser = dynamic(() => SECTION_MODULES.browser().then((m) => m.Browser))
const Terminal = dynamic(() => SECTION_MODULES.terminal().then((m) => m.Terminal))
const WhitelabelingSettings = dynamic(() =>
  SECTION_MODULES.whitelabeling().then((m) => m.WhitelabelingSettings)
)

interface SettingsPageProps {
  section: SettingsSection
}

export function SettingsPage(props: SettingsPageProps) {
  const configKey = getSettingsPermissionConfigKey(props.section)
  if (!configKey) return <SettingsPageContent {...props} />
  return (
    <PermissionAccessBoundary configKey={configKey}>
      <SettingsPageContent {...props} />
    </PermissionAccessBoundary>
  )
}

function SettingsPageContent({ section }: SettingsPageProps) {
  const { data: session, isPending: sessionLoading } = useSession()
  const hostContext = useWorkspaceHostContext()
  const { billingEnabled } = useDeploymentShape()
  const posthog = usePostHog()

  const isAdminRole = session?.user?.role === 'admin'
  const normalizedSection: SettingsSection =
    (section as string) === 'subscription' ? 'billing' : section
  const effectiveSection =
    !billingEnabled && normalizedSection === 'billing'
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
      {effectiveSection === 'connected-accounts' && organizationId && (
        <OrganizationConnectedAccounts organizationId={organizationId} />
      )}
      {effectiveSection === 'access-control' && organizationId && (
        <AccessControl
          organizationId={organizationId}
          isOrganizationAdmin={hostContext.viewer.isHostOrganizationAdmin}
          requestsHref={`/workspace/${hostContext.workspace.id}/settings/requests`}
        />
      )}
      {effectiveSection === 'requests' && organizationId && (
        <AccessRequestsSettings
          scope={{ kind: 'workspace', workspaceId: hostContext.workspace.id }}
          reviewOrganizationId={
            hostContext.viewer.isHostOrganizationAdmin ? organizationId : undefined
          }
        />
      )}
      {effectiveSection === 'custom-blocks' && <CustomBlocks />}
      {effectiveSection === 'audit-logs' && organizationId && (
        <AuditLogs organizationId={organizationId} />
      )}
      {effectiveSection === 'usage' && organizationId && (
        <UsageMonitoring
          organizationId={organizationId}
          eventsHref={`/workspace/${hostContext.workspace.id}/settings/usage/events`}
          auditLogsHref={`/workspace/${hostContext.workspace.id}/settings/audit-logs`}
        />
      )}
      {effectiveSection === 'apikeys' && <ApiKeys scope='combined' />}
      {billingEnabled && effectiveSection === 'billing' && (
        <Billing
          scope={organizationId ? 'organization' : 'account'}
          organizationId={organizationId ?? undefined}
          creditUsageHref={`/workspace/${hostContext.workspace.id}/settings/billing/credit-usage`}
        />
      )}
      {effectiveSection === 'teammates' && <Teammates />}
      {effectiveSection === 'organization' && organizationId && (
        <TeamManagement
          organizationId={organizationId}
          billingHref={`/workspace/${hostContext.workspace.id}/settings/billing`}
        />
      )}
      {effectiveSection === 'sso' && organizationId && <SSO organizationId={organizationId} />}
      {effectiveSection === 'data-retention' && organizationId && (
        <DataRetentionSettings organizationId={organizationId} />
      )}
      {effectiveSection === 'data-drains' && organizationId && (
        <DataDrainsSettings organizationId={organizationId} />
      )}
      {effectiveSection === 'security' && organizationId && (
        <OrganizationSecuritySettings organizationId={organizationId} />
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
