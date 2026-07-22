'use client'

import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import { usePostHog } from 'posthog-js/react'
import type { OrganizationSettingsSection } from '@/components/settings/navigation'
import { captureEvent } from '@/lib/posthog/client'

const TeamManagement = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/team-management/team-management').then(
    (module) => module.TeamManagement
  )
)
const Billing = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/billing/billing').then(
    (module) => module.Billing
  )
)
const AccessControl = dynamic(() =>
  import('@/ee/access-control/components/access-control').then((module) => module.AccessControl)
)
const AuditLogs = dynamic(() =>
  import('@/ee/audit-logs/components/audit-logs').then((module) => module.AuditLogs)
)
const SSO = dynamic(() => import('@/ee/sso/components/sso-settings').then((module) => module.SSO))
const SessionPolicySettings = dynamic(() =>
  import('@/ee/session-policy/components/session-policy-settings').then(
    (module) => module.SessionPolicySettings
  )
)
const NetworkPolicySettings = dynamic(() =>
  import('@/ee/network-policy/components/network-policy-settings').then(
    (module) => module.NetworkPolicySettings
  )
)
const DataRetentionSettings = dynamic(() =>
  import('@/ee/data-retention/components/data-retention-settings').then(
    (module) => module.DataRetentionSettings
  )
)
const DataDrainsSettings = dynamic(() =>
  import('@/ee/data-drains/components/data-drains-settings').then(
    (module) => module.DataDrainsSettings
  )
)
const WhitelabelingSettings = dynamic(
  () =>
    import('@/ee/whitelabeling/components/whitelabeling-settings').then(
      (module) => module.WhitelabelingSettings
    ),
  { ssr: false }
)

interface OrganizationSettingsRendererProps {
  organizationId: string
  section: OrganizationSettingsSection
}

export function OrganizationSettingsRenderer({
  organizationId,
  section,
}: OrganizationSettingsRendererProps) {
  const posthog = usePostHog()

  useEffect(() => {
    captureEvent(posthog, 'settings_tab_viewed', { plane: 'organization', section })
  }, [posthog, section])

  if (section === 'members') return <TeamManagement organizationId={organizationId} />
  if (section === 'billing') return <Billing scope='organization' organizationId={organizationId} />
  if (section === 'access-control') {
    return <AccessControl organizationId={organizationId} isOrganizationAdmin />
  }
  if (section === 'audit-logs') return <AuditLogs organizationId={organizationId} />
  if (section === 'sso') return <SSO organizationId={organizationId} />
  if (section === 'sessions') {
    return <SessionPolicySettings key={organizationId} organizationId={organizationId} />
  }
  if (section === 'network') {
    return <NetworkPolicySettings key={organizationId} organizationId={organizationId} />
  }
  if (section === 'data-retention') {
    return <DataRetentionSettings organizationId={organizationId} />
  }
  if (section === 'data-drains') return <DataDrainsSettings organizationId={organizationId} />
  return <WhitelabelingSettings organizationId={organizationId} />
}
