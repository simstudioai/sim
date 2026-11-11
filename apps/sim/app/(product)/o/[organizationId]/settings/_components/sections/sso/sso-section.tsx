'use client'

import { useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Button } from '@sim/emcn/button'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SettingsRow } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { ContentTabs } from '@sim/emcn/tabs/content-tabs'
import { getErrorMessage } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import {
  DetailHeader,
  ResourceList,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { SettingsRead } from '@/app/(product)/_components/settings-parts/settings-read'
import { ExternalLink } from '@/app/(product)/o/[organizationId]/settings/_components/section-parts/external-link'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { DomainsPanel } from '@/app/(product)/o/[organizationId]/settings/_components/sections/sso/domains-panel'
import { ProviderDetail } from '@/app/(product)/o/[organizationId]/settings/_components/sections/sso/provider-detail'
import { ProviderForm } from '@/app/(product)/o/[organizationId]/settings/_components/sections/sso/provider-form'
import { RequireSso } from '@/app/(product)/o/[organizationId]/settings/_components/sections/sso/require-sso'
import { ScimPanel } from '@/app/(product)/o/[organizationId]/settings/_components/sections/sso/scim-panel'
import { requestSettingsLeave } from '@/platform/lib/data/settings-guard'
import { useSettingsSubview } from '@/platform/lib/data/settings-subview'
import {
  canMakeProviderPrimary,
  nextSignInProvider,
  type SsoProviderView,
  useDeleteSSOProvider,
  useOrganizationPlanSeats,
  useSetPrimarySSOProvider,
  useSSOProviders,
  useSsoSettingsParams,
} from '@/platform/lib/data/sso'

const DOCS_LINKS = {
  'sign-in': 'https://docs.sim.ai/platform/enterprise/sso',
  domains: 'https://docs.sim.ai/platform/enterprise/verified-domains',
  provisioning: 'https://docs.sim.ai/platform/enterprise/scim',
} as const

interface IdentityProvidersProps {
  providers: SsoProviderView[]
  organizationId: string
  onOpen: (providerId: string) => void
  onCreate: () => void
}

function IdentityProviders({
  providers,
  organizationId,
  onOpen,
  onCreate,
}: IdentityProvidersProps) {
  const providerCountByDomain = new Map<string, number>()
  for (const provider of providers) {
    const domainKey = provider.domainKey ?? ''
    providerCountByDomain.set(domainKey, (providerCountByDomain.get(domainKey) ?? 0) + 1)
  }
  const addProvider = (
    <Button size='compact' icon='I074' onClick={onCreate}>
      Add identity provider
    </Button>
  )
  return (
    <SectionStack>
      <SettingsList
        title='Identity providers'
        empty={
          providers.length === 0
            ? {
                title: 'No identity providers yet',
                description: 'Connect a SAML or OIDC identity provider',
                action: addProvider,
              }
            : undefined
        }
      >
        <ResourceList>
          {providers.map((provider) => {
            const providerId = provider.providerId ?? ''
            const isMarkedPrimary =
              provider.isPrimary && (providerCountByDomain.get(provider.domainKey ?? '') ?? 0) > 1
            return (
              <ActivityRow
                key={provider.id ?? providerId}
                title={providerId}
                detail={`${(provider.providerType ?? 'oidc').toUpperCase()} · ${provider.domain ?? 'No domain'}`}
                textMetadata={isMarkedPrimary ? 'Primary' : undefined}
                onOpen={() => onOpen(providerId)}
              />
            )
          })}
        </ResourceList>
        <SettingsRow
          label='New identity provider'
          description='Connect a SAML or OIDC identity provider'
        >
          {addProvider}
        </SettingsRow>
      </SettingsList>
      {providers.length > 0 && <RequireSso organizationId={organizationId} />}
    </SectionStack>
  )
}

/**
 * Single sign-on: identity providers, verified domains and directory provisioning, one tab at a
 * time from the URL. A provider's detail and the create flow are sub-views that replace the page
 * header and tabs with their own `DetailHeader`; leaving one with a draft asks first.
 */
export default function SsoSection({ organization }: SettingsSectionProps) {
  const organizationId = organization.organization.id
  const { billingEnabled, features } = organization.deployment
  const [{ tab: requestedTab }, setParams] = useSsoSettingsParams()
  const subview = useSettingsSubview({ idParam: 'provider', createParam: 'createProvider' })
  const billing = useOrganizationPlanSeats(organizationId, { enabled: billingEnabled })
  const providers = useSSOProviders({ organizationId })
  const deleteProvider = useDeleteSSOProvider()
  const setPrimaryProvider = useSetPrimarySSOProvider()
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [pendingPrimaryId, setPendingPrimaryId] = useState<string | null>(null)
  const provisioningAvailable = features.scim
  const tab = requestedTab === 'provisioning' && !provisioningAvailable ? 'sign-in' : requestedTab
  const providerList = providers.data?.providers ?? []
  const selectedProvider = subview.id
    ? providerList.find((entry) => entry.providerId === subview.id)
    : undefined
  const pendingDelete = providerList.find((entry) => entry.providerId === pendingDeleteId)
  const pendingPrimary = providerList.find((entry) => entry.providerId === pendingPrimaryId)
  const deleteSignInProvider = pendingDelete
    ? nextSignInProvider(providerList, pendingDelete)
    : undefined
  const deleteDomain = pendingDelete?.domain ?? 'its domain'
  const gated = billingEnabled && billing.data !== undefined && !billing.data.data.hasEnterprisePlan

  /** A valid deep link never flashes the list before jumping to it; a dead id falls back to it. */
  if (
    (subview.id !== null || subview.creating) &&
    (providers.isPending || (billingEnabled && billing.isPending))
  ) {
    return null
  }

  const confirms = (
    <>
      <ConfirmDialog
        target={pendingPrimary}
        onClose={() => setPendingPrimaryId(null)}
        safe
        title={`Make ${pendingPrimary?.providerId ?? 'provider'} primary`}
        description={`Everyone at ${pendingPrimary?.domain ?? 'its domain'} signs in through it from their next sign-in. People already signed in stay signed in, and the current primary stays configured so you can switch back`}
        confirmLabel='Make primary'
        pendingLabel='Switching…'
        onConfirm={async ({ providerId }) => {
          if (!providerId) return
          await setPrimaryProvider.mutateAsync(providerId)
          toast.success(`${providerId} is now the primary provider`)
        }}
      />
      <ConfirmDialog
        target={pendingDelete}
        onClose={() => setPendingDeleteId(null)}
        title={`Delete ${pendingDelete?.providerId ?? 'identity provider'}`}
        description={`${
          deleteSignInProvider
            ? `People at ${deleteDomain} ${pendingDelete?.isPrimary ? 'will sign in through' : 'keep signing in through'} ${deleteSignInProvider.providerId}.`
            : `People at ${deleteDomain} can no longer sign in through it.`
        } Their accounts and memberships stay`}
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        onConfirm={async ({ providerId }) => {
          if (!providerId) return
          await deleteProvider.mutateAsync(providerId)
          toast.success('Identity provider deleted')
          if (subview.id === providerId) subview.close()
        }}
      />
    </>
  )

  if (!gated && selectedProvider) {
    return (
      <>
        <ProviderDetail
          key={`provider:${selectedProvider.providerId}`}
          organizationId={organizationId}
          provider={selectedProvider}
          onBack={subview.close}
          onRetry={() => void providers.refetch()}
          onDelete={() => setPendingDeleteId(selectedProvider.providerId ?? null)}
          onMakePrimary={
            canMakeProviderPrimary(providerList, selectedProvider)
              ? () => setPendingPrimaryId(selectedProvider.providerId ?? null)
              : undefined
          }
        />
        {confirms}
      </>
    )
  }
  if (!gated && subview.creating && providers.data) {
    return (
      <SectionStack>
        <DetailHeader
          backLabel='Identity providers'
          onBack={() => requestSettingsLeave(subview.close)}
          title='New identity provider'
          description='Use a verified email domain for this connection'
        />
        <ProviderForm key='create' organizationId={organizationId} onSaved={subview.showCreated} />
      </SectionStack>
    )
  }

  const openDomains = () => void setParams({ tab: 'domains' })
  const panels = {
    'sign-in': (
      <SettingsRead query={providers} failureMessage='Failed to load Single Sign-On settings'>
        {({ providers: list }) => (
          <IdentityProviders
            providers={list}
            organizationId={organizationId}
            onOpen={subview.open}
            onCreate={subview.create}
          />
        )}
      </SettingsRead>
    ),
    domains: <DomainsPanel organizationId={organizationId} />,
    provisioning: <ScimPanel organizationId={organizationId} onOpenDomains={openDomains} />,
  }
  const tabs = [
    { id: 'sign-in', label: 'Sign-in' },
    { id: 'domains', label: 'Domains' },
    ...(provisioningAvailable ? [{ id: 'provisioning', label: 'Provisioning' } as const] : []),
  ] as const

  return (
    <SectionStack>
      <SettingsPageHeader />
      {billingEnabled && billing.isPending ? null : billingEnabled && billing.data === undefined ? (
        <FailureNotice
          message={getErrorMessage(billing.error, 'Failed to load organization access')}
          retrying={billing.isFetching}
          onRetry={() => void billing.refetch()}
        />
      ) : gated ? (
        <SettingsList
          title='Identity providers'
          empty={{ title: 'Single sign-on is available on Enterprise plans' }}
        />
      ) : (
        <>
          {billing.isRefetchError && (
            <FailureNotice
              message={getErrorMessage(billing.error, 'Failed to refresh organization access')}
              retrying={billing.isFetching}
              onRetry={() => void billing.refetch()}
            />
          )}
          <ContentTabs
            label='Single sign-on settings'
            current={tab}
            onSelect={(id) => {
              const next = tabs.find((candidate) => candidate.id === id)
              if (next) void setParams({ tab: next.id })
            }}
            actions={<ExternalLink href={DOCS_LINKS[tab]} label='Docs' />}
            items={tabs.map((item) => ({
              id: item.id,
              label: item.label,
              content: item.id === tab ? panels[item.id] : null,
            }))}
          />
          {confirms}
        </>
      )}
    </SectionStack>
  )
}
