'use client'

import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import {
  FieldStack,
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import {
  PermissionBulkSelect,
  type PermissionControls,
  ProviderRow,
  StatusFilter,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/access-control/permission-rows'
import {
  agentDefaultModelIds,
  type EditorModel,
  isAgentDefaultUsable,
  matchesStatusFilter,
  type PermissionGroupConfig,
  type PermissionStatusFilter,
  PLATFORM_DEFAULT_MODEL,
  SIM_AUTO_MODEL_ID,
  useProviderModelLists,
} from '@/platform/lib/data/access-control'

interface AgentDefaultProps {
  config: PermissionGroupConfig
  model: EditorModel
  hosted: boolean
  onChange: (value: string | null) => void
}

/** An allowed default for new Agent blocks governed by this group. */
function AgentDefault({ config, model, hosted, onChange }: AgentDefaultProps) {
  const dynamicModels = useProviderModelLists(
    model.dynamicProviderIds.filter((provider) =>
      model.providerIds.includes(provider)
    ) as Parameters<typeof useProviderModelLists>[0],
    undefined
  )
  const { autoAllowed, models } = agentDefaultModelIds({
    config,
    providerIds: model.providerIds,
    staticModels: model.providerModels,
    dynamicModels,
    hosted,
    facts: model.facts,
  })
  const saved = config.defaultAgentModel
  const options = [
    { label: 'Platform default', value: PLATFORM_DEFAULT_MODEL },
    ...(autoAllowed ? [{ label: 'Auto', value: SIM_AUTO_MODEL_ID }] : []),
    ...models.map((id) => ({ label: id, value: id })),
  ]
  const usable = isAgentDefaultUsable(
    config,
    { hosted, providerIds: model.providerIds },
    model.facts
  )
  return (
    <SearchableSelect
      label='Agent default'
      searchLabel='Select a model'
      placeholder='Select a model'
      options={options}
      value={saved ?? PLATFORM_DEFAULT_MODEL}
      selectedLabel={saved === SIM_AUTO_MODEL_ID ? 'Auto' : (saved ?? 'Platform default')}
      error={usable ? undefined : 'Agent default must be an available, allowed model'}
      onValueChange={(next) => {
        if (next) onChange(next === PLATFORM_DEFAULT_MODEL ? null : next)
      }}
    />
  )
}

interface ProvidersTabProps {
  model: EditorModel
  controls: PermissionControls
  config: PermissionGroupConfig
  hosted: boolean
  providers: { isLoading: boolean; error: unknown; retrying: boolean; retry: () => void }
  search: string
  query: string
  status: PermissionStatusFilter
  onSearchChange: (search: string) => void
  onStatusChange: (status: PermissionStatusFilter) => void
  onAgentDefaultChange: (model: string | null) => void
}

/** The group's model providers and the default model new Agent blocks start on. */
export function ProvidersTab({
  model,
  controls,
  config,
  hosted,
  providers,
  search,
  query,
  status,
  onSearchChange,
  onStatusChange,
  onAgentDefaultChange,
}: ProvidersTabProps) {
  if (providers.isLoading) return null
  if (providers.error) {
    return (
      <FailureNotice
        message={getErrorMessage(providers.error, 'Could not load provider availability')}
        retrying={providers.retrying}
        onRetry={providers.retry}
      />
    )
  }
  const filtered = model.providerIds
    .filter((id) => !query || id.toLowerCase().includes(query))
    .filter((id) => matchesStatusFilter(status, controls.getState({ kind: 'provider', id })))
  return (
    <SectionStack>
      <SettingsSection title='Agent default'>
        <FieldStack>
          <AgentDefault
            config={config}
            model={model}
            hosted={hosted}
            onChange={onAgentDefaultChange}
          />
        </FieldStack>
      </SettingsSection>
      <SectionToolbar
        grow={
          <SearchField
            label='Search providers'
            placeholder='Search providers…'
            value={search}
            onValueChange={onSearchChange}
          />
        }
      >
        <StatusFilter value={status} onChange={onStatusChange} />
        <PermissionBulkSelect
          targets={filtered.map((id) => ({ kind: 'provider', id }))}
          controls={controls}
        />
      </SectionToolbar>
      <SettingsList
        title='Providers'
        empty={filtered.length === 0 ? { title: 'No matching providers' } : undefined}
      >
        {filtered.map((providerId) => (
          <ProviderRow key={providerId} providerId={providerId} model={model} controls={controls} />
        ))}
      </SettingsList>
    </SectionStack>
  )
}
