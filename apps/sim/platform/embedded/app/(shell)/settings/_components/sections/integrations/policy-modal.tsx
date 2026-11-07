'use client'

import { useState } from 'react'
import { Button, Chip } from '@sim/emcn/button'
import { FieldFrame } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
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
import { searchSetupParam, serializeSearchSetup } from '@/lib/sim-search/params'
import {
  ActionRow,
  Muted,
} from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import {
  useSearchPolicySave,
  useServiceAccountConnections,
} from '@/platform/embedded/lib/data/integration-settings'
import { toast } from '@/platform/shared/toast'

interface PolicyModalProps {
  organizationId: string
  integration: SearchIntegrationApproval
  onClose: () => void
}

export function PolicyModal({ organizationId, integration, onClose }: PolicyModalProps) {
  const update = useSearchPolicySave(organizationId)
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

  async function save(openSetup = needsServiceSetup) {
    if (update.pending) return
    let policy: LiveSearchPolicy
    try {
      policy = normalizeLiveSearchPolicy(provider, {
        ...defaultLiveSearchPolicy(),
        accessMode,
        ...(accessMode === 'service_account' &&
        provider !== 'gitlab' &&
        provider !== 'github' &&
        sourceId
          ? { sourceId }
          : {}),
      })
    } catch (failure) {
      setError(getErrorMessage(failure, 'Choose a service account connection and try again.'))
      return
    }
    setError('')
    if (!(await update.save(provider, policy))) return
    onClose()
    if (openSetup)
      router.push(
        serializeSearchSetup(organizationRoutes(organizationId).searchProvider(provider), {
          addConnector: searchSetupParam.parser.parse(provider),
          'source-access': null,
        })
      )
    else toast.success('Search settings saved')
  }

  const hint =
    provider === 'gitlab'
      ? 'Access follows the configured project permissions.'
      : accessMode === 'member'
        ? undefined
        : provider === 'github'
          ? 'Only added repositories that each member can access.'
          : 'Only configured resources that each member can access.'
  const message = error || update.error
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !update.pending) onClose()
      }}
      title={connectorDisplayName(provider)}
      confirmLabel={
        update.pending
          ? 'Saving'
          : needsServiceSetup
            ? provider === 'github'
              ? 'Add repository'
              : provider === 'gitlab'
                ? 'Add project'
                : 'Add connection'
            : 'Save settings'
      }
      confirmDisabled={update.pending}
      pending={update.pending}
      onConfirm={async () => {
        await save()
        return false
      }}
    >
      <FieldFrame label='Account mode' hint={hint}>
        {provider === 'gitlab' ? (
          <Muted>Service account</Muted>
        ) : supportsServiceAccount ? (
          <SegmentedControl
            label='Account mode'
            value={accessMode}
            onSelect={(value) => {
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
          <Muted>Member accounts</Muted>
        )}
      </FieldFrame>
      {accessMode === 'service_account' &&
        (provider === 'gitlab' || provider === 'github' ? (
          <FieldFrame
            label={provider === 'github' ? 'Repositories' : 'Projects and permissions'}
            hint={
              provider === 'gitlab'
                ? 'Admin tokens check current permissions; other tokens use CSV mappings.'
                : undefined
            }
          >
            {integration.approved ? (
              <div>
                <Chip href={organizationRoutes(organizationId).searchProvider(provider)}>
                  {provider === 'github' ? 'Manage GitHub repositories' : 'Manage GitLab projects'}
                </Chip>
              </div>
            ) : null}
          </FieldFrame>
        ) : (
          <ServiceAccountSource
            organizationId={organizationId}
            provider={provider}
            sourceId={sourceId}
            onChange={setSourceId}
            canManage={integration.approved}
            onAdd={() => save(true)}
            disabled={update.pending}
          />
        ))}
      {message && <InlineNotice intent='danger' message={message} />}
    </Modal>
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
  const { sources, options } = useServiceAccountConnections(organizationId, provider)
  if (
    !sourceId &&
    !sources.isPending &&
    !sources.isError &&
    !options.length &&
    !sources.hasNextPage
  )
    return null
  return (
    <>
      {(sourceId || options.length > 0 || sources.isPending) && (
        <SearchableSelect
          label='Service account connection'
          searchLabel='Search connections'
          options={options}
          value={sourceId || null}
          onValueChange={(value) => onChange(value ?? '')}
          placeholder={sources.isPending ? 'Loading connections' : 'Select a connection'}
          selectedLabel={
            sourceId && !options.some((option) => option.value === sourceId)
              ? 'Configured connection'
              : undefined
          }
          disabled={disabled || sources.isPending || sources.isError || !options.length}
        />
      )}
      {sources.isError && !sources.isFetchNextPageError && (
        <FailureNotice
          message={getErrorMessage(sources.error, 'Could not load connections')}
          retrying={sources.isFetching}
          onRetry={() => void sources.refetch()}
        />
      )}
      {sources.isFetchNextPageError ? (
        <FailureNotice
          message={getErrorMessage(sources.error, 'Could not load more connections')}
          retrying={sources.isFetchingNextPage}
          onRetry={() => void sources.fetchNextPage()}
        />
      ) : sources.hasNextPage ? (
        <div>
          <Button
            size='compact'
            disabled={sources.isFetchingNextPage}
            onClick={() => void sources.fetchNextPage()}
          >
            {sources.isFetchingNextPage ? 'Loading' : 'Load more'}
          </Button>
        </div>
      ) : null}
      {sourceId && (
        <ActionRow>
          {canManage && (
            <Chip href={organizationRoutes(organizationId).searchSource(sourceId)}>
              Edit connection
            </Chip>
          )}
          <Button size='compact' icon='I074' disabled={disabled} onClick={onAdd}>
            Add connection
          </Button>
        </ActionRow>
      )}
    </>
  )
}
