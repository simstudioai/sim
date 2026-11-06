'use client'

import { useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { canMakeProviderPrimary, nextSignInProvider } from '@/ee/sso/lib/provider-form'
import {
  ActivityRow,
  Button,
  ConfirmDialog,
  EmptyState,
  errorMessageOr,
  FailureNotice,
  LoadingRows,
  QueryBoundary,
  RowList,
  SegmentedControl,
} from '@/platform/design-system/components'
import { SettingsSection } from '@/platform/design-system/components/settings-section/settings-section'
import {
  SectionStack,
  SectionToolbar,
} from '@/platform/embedded/app/(shell)/settings/_components/section-parts/section-parts'
import type { SettingsSectionProps } from '@/platform/embedded/app/(shell)/settings/_components/section-registry'
import { DomainsPanel } from '@/platform/embedded/app/(shell)/settings/_components/sections/sso/domains-panel'
import { ProviderDetail } from '@/platform/embedded/app/(shell)/settings/_components/sections/sso/provider-detail'
import { ProviderForm } from '@/platform/embedded/app/(shell)/settings/_components/sections/sso/provider-form'
import { RequireSso } from '@/platform/embedded/app/(shell)/settings/_components/sections/sso/require-sso'
import { ScimPanel } from '@/platform/embedded/app/(shell)/settings/_components/sections/sso/scim-panel'
import { useSsoSettingsParams } from '@/platform/embedded/lib/data/sso/params'
import { useSsoProviderSettings } from '@/platform/embedded/lib/data/sso-settings'

export default function SsoSection({ organization }: SettingsSectionProps) {
  const organizationId = organization.organization.id
  const { billingEnabled, features } = organization.deployment
  const [{ tab: requestedTab, provider: requestedProvider, createProvider }, setParams] =
    useSsoSettingsParams()
  const { billing, providers, removeProvider, makePrimary } = useSsoProviderSettings(
    organizationId,
    billingEnabled
  )
  const provisioningAvailable = features.scim
  const tab = requestedTab === 'provisioning' && !provisioningAvailable ? 'sign-in' : requestedTab
  const providerList = providers.data?.providers ?? []
  const selectedProvider =
    requestedProvider && !createProvider
      ? providerList.find((entry) => entry.providerId === requestedProvider)
      : undefined
  const creating = providerList.length === 0 || createProvider
  /** Opening pushed a history entry; closing must not push another. */
  const showList = () =>
    void setParams({ provider: null, createProvider: null }, { history: 'replace' })
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
    return <LoadingRows label='Loading sign-in settings…' />
  }
  if (billingEnabled && billing.data === undefined && billing.error) {
    return (
      <FailureNotice
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
        <FailureNotice
          message={getErrorMessage(billing.error, 'Failed to refresh organization access')}
          retrying={billing.isFetching}
          onRetry={() => void billing.refetch()}
        />
      )}
      <SectionToolbar
        grow={
          <SegmentedControl
            label='Single sign-on settings'
            options={[
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
        {tab === 'sign-in' && !creating && !selectedProvider && !providers.isLoading && (
          <Button
            variant='primary'
            size='compact'
            icon='I074'
            onClick={() => void setParams({ provider: null, createProvider: true })}
          >
            Add identity provider
          </Button>
        )}
      </SectionToolbar>

      {/* Hidden tabs stay mounted, so a draft survives switching to Domains to verify one. */}
      <div hidden={tab !== 'sign-in'}>
        <SectionStack>
          <QueryBoundary
            query={providers}
            failure={errorMessageOr('Failed to load Single Sign-On settings')}
            loadingLabel='Loading identity providers…'
          >
            {() =>
              !creating && !selectedProvider ? (
                <>
                  <SettingsSection title='Identity providers'>
                    <RowList>
                      {providerList.map((provider) => {
                        const providerId = provider.providerId ?? ''
                        const isMarkedPrimary =
                          provider.isPrimary &&
                          (providerCountByDomain.get(provider.domainKey ?? '') ?? 0) > 1
                        return (
                          <ActivityRow
                            density='comfortable'
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
                    </RowList>
                  </SettingsSection>
                  <RequireSso organizationId={organizationId} />
                </>
              ) : selectedProvider ? (
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
              )
            }
          </QueryBoundary>
        </SectionStack>
      </div>

      <ConfirmDialog
        target={tab === 'sign-in' && pendingPrimary !== undefined}
        onClose={() => setPendingPrimaryId(null)}
        title='Make primary provider'
        description={`Make ${pendingPrimary?.providerId ?? 'this provider'} the primary provider for ${pendingPrimary?.domain ?? 'its domain'}? Everyone there signs in through it from their next sign-in. People already signed in stay signed in, and the current primary stays configured so you can switch back.`}
        confirmLabel='Make primary'
        pendingLabel='Switching…'
        onConfirm={async () => {
          if (!pendingPrimary?.providerId) return
          await makePrimary(pendingPrimary.providerId)
        }}
        safe
      />
      <ConfirmDialog
        target={tab === 'sign-in' && pendingDelete !== undefined}
        onClose={() => setPendingDeleteId(null)}
        title='Delete identity provider'
        description={`Delete ${pendingDelete?.providerId ?? 'this provider'}? ${
          deleteSignInProvider
            ? `People at ${deleteDomain} ${pendingDelete?.isPrimary ? 'will sign in through' : 'keep signing in through'} ${deleteSignInProvider.providerId}.`
            : `People at ${deleteDomain} can no longer sign in through it.`
        } Their accounts and memberships stay.`}
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        onConfirm={async () => {
          if (!pendingDelete?.providerId) return
          await removeProvider(pendingDelete.providerId)
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
