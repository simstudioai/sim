'use client'

import { useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import {
  LoadingState,
  QueryErrorState,
  ResourceList,
  SectionStack,
  SectionTabs,
  SectionToolbar,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { DomainsPanel } from '@/platform/app/(shell)/settings/_components/sections/sso/domains-panel'
import { ProviderDetail } from '@/platform/app/(shell)/settings/_components/sections/sso/provider-detail'
import { ProviderForm } from '@/platform/app/(shell)/settings/_components/sections/sso/provider-form'
import { RequireSso } from '@/platform/app/(shell)/settings/_components/sections/sso/require-sso'
import { ScimPanel } from '@/platform/app/(shell)/settings/_components/sections/sso/scim-panel'
import { ActivityRow, Button, EmptyState, Modal } from '@/platform/design-system/components'
import { SettingsSection } from '@/platform/design-system/components/settings-section/settings-section'
import {
  canMakeProviderPrimary,
  nextSignInProvider,
  useDeleteSSOProvider,
  useOrganizationPlanSeats,
  useSetPrimarySSOProvider,
  useSSOProviders,
  useSsoSettingsParams,
} from '@/platform/lib/data/sso'
import { toast } from '@/platform/lib/data/toast'

const DOCS_LINKS = {
  'sign-in': 'https://docs.sim.ai/platform/enterprise/sso',
  domains: 'https://docs.sim.ai/platform/enterprise/verified-domains',
  provisioning: 'https://docs.sim.ai/platform/enterprise/scim',
} as const

function DocsLink({ href }: { href: string }) {
  return (
    <Button
      variant='quiet'
      size='compact'
      render={
        <a href={href} target='_blank' rel='noreferrer'>
          Docs
        </a>
      }
    >
      Docs
    </Button>
  )
}

export default function SsoSection({ organization }: SettingsSectionProps) {
  const organizationId = organization.organization.id
  const { billingEnabled, features } = organization.deployment
  const [{ tab: requestedTab, provider: requestedProvider, createProvider }, setParams] =
    useSsoSettingsParams()
  const billing = useOrganizationPlanSeats(organizationId, { enabled: billingEnabled })
  const providers = useSSOProviders({ organizationId })
  const provisioningAvailable = features.scim
  const tab = requestedTab === 'provisioning' && !provisioningAvailable ? 'sign-in' : requestedTab
  const providerList = providers.data?.providers ?? []
  const selectedProvider =
    requestedProvider && !createProvider
      ? providerList.find((entry) => entry.providerId === requestedProvider)
      : undefined
  const signInView: 'create' | 'detail' | 'list' =
    providerList.length === 0 || createProvider ? 'create' : selectedProvider ? 'detail' : 'list'
  /** Opening pushed a history entry; closing must not push another. */
  const showList = () =>
    void setParams({ provider: null, createProvider: null }, { history: 'replace' })
  const deleteProvider = useDeleteSSOProvider()
  const setPrimaryProvider = useSetPrimarySSOProvider()
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [pendingPrimaryId, setPendingPrimaryId] = useState<string | null>(null)
  const pendingDelete = providerList.find((entry) => entry.providerId === pendingDeleteId)
  const pendingPrimary = providerList.find((entry) => entry.providerId === pendingPrimaryId)
  const deleteSignInProvider = pendingDelete
    ? nextSignInProvider(providerList, pendingDelete)
    : undefined
  const deleteDomain = pendingDelete?.domain ?? 'its domain'
  const canMakeSelectedPrimary =
    selectedProvider !== undefined && canMakeProviderPrimary(providerList, selectedProvider)
  const openDomains = () => void setParams({ tab: 'domains' })

  if (billingEnabled && billing.isLoading) {
    return <LoadingState label='Loading sign-in settings…' />
  }
  if (billingEnabled && billing.data === undefined && billing.error) {
    return (
      <QueryErrorState
        message={getErrorMessage(billing.error, 'Failed to load organization access')}
        retrying={billing.isFetching}
        onRetry={() => void billing.refetch()}
      />
    )
  }
  if (billingEnabled && !billing.data?.data.hasEnterprisePlan) {
    return <EmptyState title='Single Sign-On is available on Enterprise plans only.' />
  }

  const providerCountByDomain = new Map<string, number>()
  for (const provider of providerList) {
    const domainKey = provider.domainKey ?? ''
    providerCountByDomain.set(domainKey, (providerCountByDomain.get(domainKey) ?? 0) + 1)
  }

  return (
    <SectionStack>
      {billing.error != null && (
        <QueryErrorState
          message={getErrorMessage(billing.error, 'Failed to refresh organization access')}
          retrying={billing.isFetching}
          onRetry={() => void billing.refetch()}
        />
      )}
      <SectionToolbar
        grow={
          <SectionTabs
            label='Single sign-on settings'
            tabs={[
              { value: 'sign-in', label: 'Sign-in' },
              { value: 'domains', label: 'Domains' },
              ...(provisioningAvailable
                ? [{ value: 'provisioning' as const, label: 'Provisioning' }]
                : []),
            ]}
            value={tab}
            onSelect={(next) => void setParams({ tab: next })}
          />
        }
      >
        <DocsLink href={DOCS_LINKS[tab]} />
      </SectionToolbar>

      {/* Hidden tabs stay mounted, so a draft survives switching to Domains to verify one. */}
      <div hidden={tab !== 'sign-in'}>
        <SectionStack>
          {providers.isLoading ? (
            <LoadingState label='Loading identity providers…' />
          ) : providers.data === undefined && providers.error ? (
            <QueryErrorState
              message={getErrorMessage(providers.error, 'Failed to load Single Sign-On settings')}
              retrying={providers.isFetching}
              onRetry={() => void providers.refetch()}
            />
          ) : signInView === 'list' ? (
            <>
              <SectionToolbar>
                <Button
                  variant='primary'
                  onClick={() => void setParams({ provider: null, createProvider: true })}
                >
                  Add identity provider
                </Button>
              </SectionToolbar>
              <SettingsSection title='Identity providers'>
                <ResourceList>
                  {providerList.map((provider) => {
                    const providerId = provider.providerId ?? ''
                    const isMarkedPrimary =
                      provider.isPrimary &&
                      (providerCountByDomain.get(provider.domainKey ?? '') ?? 0) > 1
                    return (
                      <ActivityRow
                        key={provider.id ?? providerId}
                        title={providerId}
                        detail={`${(provider.providerType ?? 'oidc').toUpperCase()} · ${provider.domain ?? 'no domain'}`}
                        metadata={isMarkedPrimary ? 'Primary' : undefined}
                        onOpen={() =>
                          void setParams({ provider: providerId, createProvider: null })
                        }
                      />
                    )
                  })}
                </ResourceList>
              </SettingsSection>
              <RequireSso organizationId={organizationId} />
            </>
          ) : signInView === 'detail' && selectedProvider ? (
            <ProviderDetail
              key={`provider:${selectedProvider.providerId}`}
              organizationId={organizationId}
              provider={selectedProvider}
              onBack={showList}
              onDelete={() => setPendingDeleteId(selectedProvider.providerId ?? null)}
              onMakePrimary={
                canMakeSelectedPrimary
                  ? () => setPendingPrimaryId(selectedProvider.providerId ?? null)
                  : undefined
              }
            />
          ) : (
            <ProviderForm
              key='create'
              organizationId={organizationId}
              onOpenDomains={openDomains}
              onSaved={(providerId) =>
                void setParams(
                  { provider: providerId, createProvider: null },
                  { history: 'replace' }
                )
              }
              onBack={providerList.length > 0 ? showList : undefined}
            />
          )}
        </SectionStack>
      </div>

      <Modal
        variant='confirm'
        open={tab === 'sign-in' && pendingPrimary !== undefined}
        onOpenChange={(open) => {
          if (!open) setPendingPrimaryId(null)
        }}
        title='Make primary provider'
        description={`Make ${pendingPrimary?.providerId ?? 'this provider'} the primary provider for ${pendingPrimary?.domain ?? 'its domain'}? Everyone there signs in through it from their next sign-in. People already signed in stay signed in, and the current primary stays configured so you can switch back.`}
        confirmLabel={setPrimaryProvider.isPending ? 'Switching…' : 'Make primary'}
        onConfirm={async () => {
          if (!pendingPrimary?.providerId) return
          await setPrimaryProvider.mutateAsync(pendingPrimary.providerId)
          toast.success(`${pendingPrimary.providerId} is now the primary provider`)
        }}
      />
      <Modal
        variant='confirm'
        destructive
        open={tab === 'sign-in' && pendingDelete !== undefined}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null)
        }}
        title='Delete identity provider'
        description={`Delete ${pendingDelete?.providerId ?? 'this provider'}? ${
          deleteSignInProvider
            ? `People at ${deleteDomain} ${pendingDelete?.isPrimary ? 'will sign in through' : 'keep signing in through'} ${deleteSignInProvider.providerId}.`
            : `People at ${deleteDomain} can no longer sign in through it.`
        } Their accounts and memberships stay.`}
        confirmLabel={deleteProvider.isPending ? 'Deleting…' : 'Delete'}
        onConfirm={async () => {
          if (!pendingDelete?.providerId) return
          await deleteProvider.mutateAsync(pendingDelete.providerId)
          toast.success('Identity provider deleted')
          if (selectedProvider?.providerId === pendingDelete.providerId) showList()
        }}
      />

      <div hidden={tab !== 'domains'}>
        <DomainsPanel organizationId={organizationId} active={tab === 'domains'} />
      </div>
      {provisioningAvailable && (
        <div hidden={tab !== 'provisioning'}>
          <ScimPanel
            organizationId={organizationId}
            active={tab === 'provisioning'}
            onOpenDomains={openDomains}
          />
        </div>
      )}
    </SectionStack>
  )
}
