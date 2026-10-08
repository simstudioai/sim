'use client'

import { useId, useMemo, useState } from 'react'
import { ChipCombobox, type ComboboxOption } from '@sim/emcn'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import { createModelAccessGate } from '@/lib/permission-groups/model-access'
import { SettingRow } from '@/ee/components/setting-row'
import { useProviderModelLists } from '@/hooks/queries/providers'
import {
  DYNAMIC_MODEL_PROVIDERS,
  getModelSunsetStatus,
  getProviderIcon,
  getProviderModels,
} from '@/providers/models'
import type { ProviderId } from '@/providers/types'

const PLATFORM_DEFAULT = '__platform-default__'

interface AgentDefaultProps {
  config: PermissionGroupConfig
  providerIds: ProviderId[]
  workspaceId?: string
  onChange: (model: string | null) => void
}

/** Selects an allowed default for new Agent blocks governed by this group. */
export function AgentDefault({ config, providerIds, workspaceId, onChange }: AgentDefaultProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const dynamicModels = useProviderModelLists(
    DYNAMIC_MODEL_PROVIDERS.filter((provider) => providerIds.includes(provider)),
    workspaceId,
    { enabled: open }
  )
  const options = useMemo((): ComboboxOption[] => {
    const isAllowed = createModelAccessGate(config)
    const models = new Set([
      ...providerIds.flatMap((provider) => getProviderModels(provider)),
      ...dynamicModels,
    ])
    return [
      { label: 'Platform default', value: PLATFORM_DEFAULT },
      ...[...models]
        .filter((model) => isAllowed(model) && getModelSunsetStatus(model) !== 'deprecated')
        .map((model) => ({
          label: model,
          value: model,
          icon: getProviderIcon(model) ?? undefined,
        })),
    ]
  }, [config, providerIds, dynamicModels])

  const error =
    config.defaultAgentModel && !createModelAccessGate(config)(config.defaultAgentModel)
      ? 'Agent default must be an allowed model'
      : undefined

  return (
    <SettingRow label='Agent default' htmlFor={id} error={error}>
      <ChipCombobox
        id={id}
        options={options}
        value={config.defaultAgentModel ?? PLATFORM_DEFAULT}
        onChange={(model) => onChange(model === PLATFORM_DEFAULT ? null : model)}
        placeholder='Select a model'
        searchable
        error={error}
        onOpenChange={setOpen}
        className='w-full'
      />
    </SettingRow>
  )
}
