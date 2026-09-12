'use client'

import { ChipCopyInput } from '@sim/emcn'
import { SettingsPanel } from '@/components/settings/settings-panel'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { SessionPolicySettings } from '@/ee/session-policy/components/session-policy-settings'
import { useOrganizationNetwork } from '@/hooks/queries/organization-network'

interface OrganizationSecuritySettingsProps {
  organizationId: string
}

export function OrganizationSecuritySettings({
  organizationId,
}: OrganizationSecuritySettingsProps) {
  const { hosted, features } = useDeploymentShape()

  return (
    <div className='flex flex-col gap-7'>
      {hosted || features.sessionPolicies ? (
        <SettingsSection label='Session policies'>
          <SessionPolicySettings key={organizationId} organizationId={organizationId} />
        </SettingsSection>
      ) : (
        <SettingsPanel />
      )}
      <OrganizationNetworkSection organizationId={organizationId} />
    </div>
  )
}

function OrganizationNetworkSection({ organizationId }: OrganizationSecuritySettingsProps) {
  const { data, error, isPending, isFetching, refetch } = useOrganizationNetwork(organizationId)

  return (
    <SettingsSection label='Outbound IP addresses'>
      {isPending ? (
        <SettingsEmptyState variant='inline'>
          <span role='status'>Loading network settings…</span>
        </SettingsEmptyState>
      ) : error || data?.mode === 'unavailable' ? (
        <SettingsQueryErrorState
          error={error}
          fallback='Could not load network settings'
          isRetrying={isFetching}
          onRetry={() => void refetch()}
          variant='inline'
        />
      ) : data?.mode === 'gateway' && data.publicIps.length > 0 ? (
        <div className='flex flex-col gap-3'>
          <p className='text-[var(--text-muted)] text-caption'>
            Allowlist every address below for supported HTTPS connections.
          </p>
          <div className='flex flex-col gap-2'>
            {data.publicIps.map((ip) => (
              <ChipCopyInput
                key={ip}
                value={`${ip}/32`}
                aria-label={`Outbound IP ${ip}`}
                copyLabel={`Copy ${ip}/32`}
                inputClassName='font-mono'
              />
            ))}
          </div>
        </div>
      ) : data ? (
        <p role='status' className='text-[var(--text-muted)] text-sm'>
          {data.mode === 'blocked'
            ? 'Outbound connections are paused. Contact your administrator.'
            : data.mode === 'gateway'
              ? 'Your outbound IP addresses aren’t available yet.'
              : 'Outbound IP addresses are not configured for this organization.'}
        </p>
      ) : null}
    </SettingsSection>
  )
}
