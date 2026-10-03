'use client'

import { useState } from 'react'
import {
  Chip,
  ChipLink,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipSelect,
  ChipSwitch,
  toast,
} from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import type { SearchIntegrationApproval } from '@/lib/api/contracts/knowledge/search-integrations'
import { organizationRoutes } from '@/lib/navigation/paths'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
import {
  defaultLiveSearchPolicy,
  LIVE_SEARCH_SERVICE_PROVIDERS,
  type LiveSearchPolicy,
  normalizeLiveSearchPolicy,
} from '@/lib/sim-search/live/policy-schema'
import { searchSetupParam, serializeSearchSetup } from '@/lib/sim-search/search-params'
import { SearchSourcePagination } from '@/app/o/[organizationId]/settings/components/integrations/search-source-pagination'
import { useSearchSources } from '@/hooks/queries/kb/connectors'
import { useUpdateSearchIntegration } from '@/hooks/queries/search-integrations'

interface LiveSearchPolicyModalProps {
  organizationId: string
  integration: SearchIntegrationApproval
  onClose: () => void
}

export function LiveSearchPolicyModal({
  organizationId,
  integration,
  onClose,
}: LiveSearchPolicyModalProps) {
  const update = useUpdateSearchIntegration()
  const router = useRouter()
  const provider = integration.connectorType
  const [accessMode, setAccessMode] = useState<NonNullable<LiveSearchPolicy['accessMode']>>(
    provider === 'gitlab' ? 'service_account' : (integration.policy?.accessMode ?? 'member')
  )
  const [sourceId, setSourceId] = useState(integration.policy?.sourceId ?? '')
  const [error, setError] = useState('')
  const supportsServiceAccount = LIVE_SEARCH_SERVICE_PROVIDERS.includes(provider)
  const needsServiceSetup =
    accessMode === 'service_account' &&
    (provider === 'github'
      ? !integration.approved || integration.policy?.accessMode !== 'service_account'
      : provider === 'gitlab'
        ? !integration.approved
        : !sourceId)
  const close = () => {
    if (!update.isPending) onClose()
  }
  const save = (openSetup = needsServiceSetup) => {
    if (update.isPending) return
    try {
      const policy = normalizeLiveSearchPolicy(provider, {
        ...defaultLiveSearchPolicy(),
        accessMode,
        ...(accessMode === 'service_account' &&
        provider !== 'gitlab' &&
        provider !== 'github' &&
        sourceId
          ? { sourceId }
          : {}),
      })
      setError('')
      update.mutate(
        { organizationId, connectorType: provider, approved: true, policy },
        {
          onSuccess: () => {
            onClose()
            if (openSetup)
              router.push(
                serializeSearchSetup(organizationRoutes(organizationId).searchProvider(provider), {
                  addConnector: searchSetupParam.parser.parse(provider),
                  'source-access': null,
                })
              )
            else toast.success('Search settings saved')
          },
        }
      )
    } catch (error) {
      setError(getErrorMessage(error, 'Choose a service account connection and try again.'))
    }
  }
  return (
    <ChipModal
      open
      dismissDisabled={update.isPending}
      onOpenChange={(open) => {
        if (!open) close()
      }}
      srTitle={`${connectorDisplayName(provider)} search settings`}
    >
      <ChipModalHeader onClose={close}>{connectorDisplayName(provider)}</ChipModalHeader>
      <ChipModalBody>
        <fieldset disabled={update.isPending} className='flex min-w-0 flex-col gap-4'>
          <ChipModalField
            type='custom'
            title='Account mode'
            hint={
              provider === 'gitlab'
                ? 'Access follows the configured project permissions.'
                : accessMode === 'member'
                  ? undefined
                  : provider === 'github'
                    ? 'Only added repositories that each member can access.'
                    : 'Only configured resources that each member can access.'
            }
          >
            {provider === 'gitlab' ? (
              <p className='text-[var(--text-body)] text-small'>Service account</p>
            ) : supportsServiceAccount ? (
              <ChipSwitch
                aria-label='Account mode'
                value={accessMode}
                onChange={(value) => {
                  setAccessMode(value)
                  setError('')
                }}
                options={[
                  { value: 'member', label: 'Member accounts' },
                  {
                    value: 'service_account',
                    label: provider === 'github' ? 'GitHub App' : 'Service account',
                  },
                ]}
              />
            ) : (
              <p className='text-[var(--text-body)] text-small'>Member accounts</p>
            )}
          </ChipModalField>
          {accessMode === 'service_account' &&
            (provider === 'gitlab' || provider === 'github' ? (
              <ChipModalField
                type='custom'
                title={provider === 'github' ? 'Repositories' : 'Projects and permissions'}
                hint={
                  provider === 'gitlab'
                    ? 'Admin tokens check current permissions; other tokens use CSV mappings.'
                    : undefined
                }
              >
                {integration.approved ? (
                  <ChipLink href={organizationRoutes(organizationId).searchProvider(provider)}>
                    {provider === 'github'
                      ? 'Manage GitHub repositories'
                      : 'Manage GitLab projects'}
                  </ChipLink>
                ) : null}
              </ChipModalField>
            ) : (
              <ServiceAccountSource
                organizationId={organizationId}
                provider={provider}
                sourceId={sourceId}
                onChange={setSourceId}
                canManage={integration.approved}
                onAdd={() => save(true)}
                disabled={update.isPending}
              />
            ))}
          <ChipModalError>{error || update.error?.message}</ChipModalError>
        </fieldset>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={close}
        primaryAction={{
          label: update.isPending
            ? 'Saving'
            : needsServiceSetup
              ? provider === 'github'
                ? 'Add repository'
                : provider === 'gitlab'
                  ? 'Add project'
                  : 'Add connection'
              : 'Save settings',
          onClick: () => save(),
          disabled: update.isPending,
        }}
      />
    </ChipModal>
  )
}

interface ServiceAccountSourceProps {
  organizationId: string
  provider: string
  sourceId: string
  onChange: (sourceId: string) => void
  canManage: boolean
  onAdd: () => void
  disabled: boolean
}

function ServiceAccountSource({
  organizationId,
  provider,
  sourceId,
  onChange,
  canManage,
  onAdd,
  disabled,
}: ServiceAccountSourceProps) {
  const sources = useSearchSources(
    { kind: 'organization', organizationId },
    { connectorType: provider }
  )
  const options = (sources.data ?? [])
    .filter((source) => source.accessMode === 'admin')
    .map((source) => ({
      value: source.connectorId,
      label: `${source.sourceDescription || connectorDisplayName(provider)}${source.enabled ? '' : ' · Paused'}`,
      disabled: !source.enabled || source.availability !== 'available',
    }))
  if (
    !sourceId &&
    !sources.isPending &&
    !sources.isError &&
    !options.length &&
    !sources.hasNextPage
  )
    return null
  return (
    <ChipModalField type='custom' title='Service account connection'>
      <div className='flex flex-col items-start gap-2'>
        {(sourceId || options.length > 0 || sources.isPending) && (
          <ChipSelect
            aria-label='Service account connection'
            options={options}
            value={sourceId}
            onChange={onChange}
            placeholder={sources.isPending ? 'Loading connections' : 'Select a connection'}
            displayLabel={
              sourceId && !options.some((option) => option.value === sourceId)
                ? 'Configured connection'
                : undefined
            }
            disabled={disabled || sources.isPending || sources.isError || !options.length}
            searchable
            fullWidth
            dropdownWidth='trigger'
            align='start'
          />
        )}
        {sources.isError && !sources.isFetchNextPageError && (
          <>
            <ChipModalError>{sources.error?.message}</ChipModalError>
            <Chip disabled={sources.isFetching} onClick={() => void sources.refetch()}>
              Retry
            </Chip>
          </>
        )}
        <SearchSourcePagination {...sources} />
        {sourceId && (
          <div className='flex flex-wrap gap-2'>
            {canManage && (
              <ChipLink href={organizationRoutes(organizationId).searchSource(sourceId)}>
                Edit connection
              </ChipLink>
            )}
            <Chip leftIcon={Plus} disabled={disabled} onClick={onAdd}>
              Add connection
            </Chip>
          </div>
        )}
      </div>
    </ChipModalField>
  )
}
