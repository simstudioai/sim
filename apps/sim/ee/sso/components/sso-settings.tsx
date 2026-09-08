'use client'

import { ChipModalTabs } from '@sim/emcn'
import { useQueryStates } from 'nuqs'
import { useSession } from '@/lib/auth/auth-client'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { ScimSection } from '@/ee/scim/components/scim-section'
import { SsoProviderSettings } from '@/ee/sso/components/sso-provider-settings'
import { VerifiedDomainsSection } from '@/ee/sso/components/verified-domains-section'
import { useSSOProviders } from '@/ee/sso/hooks/sso'
import { ssoSettingsParsers, ssoSettingsUrlKeys } from '@/ee/sso/search-params'
import { useOrganizationBilling } from '@/hooks/queries/organization'

const SETTINGS_TABS = [
  { value: 'sign-in', label: 'Sign-in' },
  { value: 'domains', label: 'Domains' },
  { value: 'provisioning', label: 'Provisioning' },
] as const

const DOCS_LINKS = {
  'sign-in': 'https://docs.sim.ai/platform/enterprise/sso',
  domains: 'https://docs.sim.ai/platform/enterprise/verified-domains',
  provisioning: 'https://docs.sim.ai/platform/enterprise/scim',
} as const

interface SSOProps {
  organizationId: string
}

export function SSO({ organizationId }: SSOProps) {
  return <OrganizationSsoSettings key={organizationId} organizationId={organizationId} />
}

function OrganizationSsoSettings({ organizationId }: SSOProps) {
  const [{ tab: requestedTab }, setParams] = useQueryStates(ssoSettingsParsers, ssoSettingsUrlKeys)
  const { data: session } = useSession()
  const { billingEnabled, features } = useDeploymentShape()
  const billing = useOrganizationBilling(organizationId)
  const providers = useSSOProviders({ organizationId })
  const provisioningAvailable = features.scim
  const tab = requestedTab === 'provisioning' && !provisioningAvailable ? 'sign-in' : requestedTab
  const providerList = providers.data?.providers ?? []
  const provider = providerList[0]
  const canManageProvider =
    billingEnabled ||
    providerList.length === 0 ||
    providerList.some((entry) => entry.userId === session?.user?.id)

  if (billingEnabled && billing.isLoading) {
    return <SettingsEmptyState variant='inline'>Loading sign-in settings...</SettingsEmptyState>
  }

  if (billingEnabled && billing.data === undefined && billing.error) {
    return (
      <SettingsQueryErrorState
        error={billing.error}
        fallback='Failed to load organization billing'
        isRetrying={billing.isFetching}
        onRetry={() => void billing.refetch()}
      />
    )
  }

  if (billingEnabled && !isEnterprise(billing.data?.data?.subscriptionPlan)) {
    return (
      <SettingsEmptyState>Single Sign-On is available on Enterprise plans only.</SettingsEmptyState>
    )
  }

  return (
    <div className='flex flex-col gap-7'>
      <ChipModalTabs
        tabs={SETTINGS_TABS.filter(
          (entry) => entry.value !== 'provisioning' || provisioningAvailable
        )}
        value={tab}
        onChange={(value) => {
          const next = SETTINGS_TABS.find((entry) => entry.value === value)
          if (next) void setParams({ tab: next.value })
        }}
        aria-label='Single sign-on settings'
      />

      <div hidden={tab !== 'sign-in'}>
        {providers.isLoading ? (
          <SettingsEmptyState variant='inline'>Loading identity provider...</SettingsEmptyState>
        ) : providers.data === undefined && providers.error ? (
          <SettingsQueryErrorState
            error={providers.error}
            fallback='Failed to load Single Sign-On settings'
            isRetrying={providers.isFetching}
            onRetry={() => void providers.refetch()}
          />
        ) : !canManageProvider ? (
          <SettingsEmptyState variant='inline'>
            Only the user who configured SSO can manage these settings.
          </SettingsEmptyState>
        ) : (
          <SsoProviderSettings
            organizationId={organizationId}
            existingProvider={provider}
            active={tab === 'sign-in'}
            onOpenDomains={() => void setParams({ tab: 'domains' })}
          />
        )}
      </div>

      {tab === 'domains' && (
        <SettingsPanel docsLink={DOCS_LINKS.domains}>
          <VerifiedDomainsSection organizationId={organizationId} />
        </SettingsPanel>
      )}

      {provisioningAvailable && (
        <div hidden={tab !== 'provisioning'}>
          {tab === 'provisioning' && <SettingsPanel docsLink={DOCS_LINKS.provisioning} />}
          <ScimSection
            active={tab === 'provisioning'}
            organizationId={organizationId}
            onOpenDomains={() => void setParams({ tab: 'domains' })}
          />
        </div>
      )}
    </div>
  )
}
