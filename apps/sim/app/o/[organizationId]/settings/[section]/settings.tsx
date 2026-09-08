'use client'

import dynamic from 'next/dynamic'
import {
  getOrganizationSettingsHref,
  ORGANIZATION_SETTINGS_ITEMS,
  type OrganizationSettingsSection,
} from '@/components/settings/navigation'
import { SettingsSectionProvider } from '@/components/settings/settings-panel'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { OrganizationIntegrationsSettings } from '@/app/o/[organizationId]/settings/components/integrations/organization-integrations-settings'
import { OrganizationSearchMcp } from '@/app/o/[organizationId]/settings/components/organization-search-mcp'
import { OrganizationConnectedAccounts } from '@/ee/credential-groups/components/organization-connected-accounts'

const TeamManagement = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/team-management/team-management').then(
    (m) => m.TeamManagement
  )
)
const Billing = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/billing/billing').then((m) => m.Billing)
)
const AccessControl = dynamic(() =>
  import('@/ee/access-control/components/access-control').then((m) => m.AccessControl)
)
const AuditLogs = dynamic(() =>
  import('@/ee/audit-logs/components/audit-logs').then((m) => m.AuditLogs)
)
const SSO = dynamic(() => import('@/ee/sso/components/sso-settings').then((m) => m.SSO))
const SessionPolicySettings = dynamic(() =>
  import('@/ee/session-policy/components/session-policy-settings').then(
    (m) => m.SessionPolicySettings
  )
)
const DataRetentionSettings = dynamic(() =>
  import('@/ee/data-retention/components/data-retention-settings').then(
    (m) => m.DataRetentionSettings
  )
)
const DataDrainsSettings = dynamic(() =>
  import('@/ee/data-drains/components/data-drains-settings').then((m) => m.DataDrainsSettings)
)
const UsageMonitoring = dynamic(() =>
  import('@/ee/organization-usage/components/usage-monitoring').then((m) => m.UsageMonitoring)
)
const WhitelabelingSettings = dynamic(() =>
  import('@/ee/whitelabeling/components/whitelabeling-settings').then(
    (m) => m.WhitelabelingSettings
  )
)

interface OrganizationSettingsProps {
  section: OrganizationSettingsSection
}

export function OrganizationSettings({ section }: OrganizationSettingsProps) {
  const { organization, viewer } = useOrganizationContext()
  const organizationId = organization.id
  const meta = ORGANIZATION_SETTINGS_ITEMS.find(({ id }) => id === section)

  return (
    <SettingsSectionProvider section={section} meta={meta}>
      {section === 'integrations' && <OrganizationIntegrationsSettings />}
      {section === 'connected-accounts' && (
        <OrganizationConnectedAccounts organizationId={organizationId} />
      )}
      {section === 'search-mcp' && <OrganizationSearchMcp />}
      {section === 'members' && (
        <TeamManagement
          organizationId={organizationId}
          canInviteMembers={viewer.canInviteMembers}
          billingHref={getOrganizationSettingsHref(organizationId, 'billing')}
        />
      )}
      {section === 'billing' && <Billing scope='organization' organizationId={organizationId} />}
      {section === 'access-control' && (
        <AccessControl organizationId={organizationId} isOrganizationAdmin={viewer.isAdmin} />
      )}
      {section === 'audit-logs' && <AuditLogs organizationId={organizationId} />}
      {section === 'usage' && (
        <UsageMonitoring
          organizationId={organizationId}
          eventsHref={`${getOrganizationSettingsHref(organizationId, 'usage')}/events`}
          auditLogsHref={getOrganizationSettingsHref(organizationId, 'audit-logs')}
        />
      )}
      {section === 'sso' && <SSO organizationId={organizationId} />}
      {section === 'sessions' && <SessionPolicySettings organizationId={organizationId} />}
      {section === 'data-retention' && <DataRetentionSettings organizationId={organizationId} />}
      {section === 'data-drains' && <DataDrainsSettings organizationId={organizationId} />}
      {section === 'whitelabeling' && <WhitelabelingSettings organizationId={organizationId} />}
    </SettingsSectionProvider>
  )
}
