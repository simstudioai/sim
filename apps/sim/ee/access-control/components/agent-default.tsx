'use client'

import { useMemo, useState } from 'react'
import { ChipCombobox, type ComboboxOption } from '@sim/emcn'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import {
  createModelAccessGate,
  resolveAgentDefaultModel,
} from '@/lib/permission-groups/model-access'
import { SettingRow } from '@/ee/components/setting-row'
import { useProviderModelLists } from '@/hooks/queries/providers'
import {
  DYNAMIC_MODEL_PROVIDERS,
  getModelSunsetStatus,
  getProviderIcon,
  getProviderModels,
  SIM_AUTO_MODEL_ID,
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
  const { hosted } = useDeploymentShape()
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
    const modelOptions: ComboboxOption[] = [
      { label: 'Platform default', value: PLATFORM_DEFAULT },
      ...(hosted && isAllowed(SIM_AUTO_MODEL_ID)
        ? [{ label: 'Auto', value: SIM_AUTO_MODEL_ID }]
        : []),
      ...[...models]
        .filter((model) => isAllowed(model) && getModelSunsetStatus(model) !== 'deprecated')
        .map((model) => ({
          label: model,
          value: model,
          icon: getProviderIcon(model) ?? undefined,
        })),
    ]
    const savedModel = config.defaultAgentModel
    if (savedModel && !modelOptions.some((option) => option.value === savedModel)) {
      modelOptions.push({
        label: savedModel,
        value: savedModel,
        icon: getProviderIcon(savedModel) ?? undefined,
        hidden: true,
      })
    }
    return modelOptions
  }, [config, providerIds, dynamicModels, hosted])

  const error =
    config.defaultAgentModel &&
    !resolveAgentDefaultModel(config, { allowAuto: hosted, availableProviderIds: providerIds })
      ? 'Agent default must be an available, allowed model'
      : undefined

  return (
    <SettingRow label='Agent default' error={error}>
      <ChipCombobox
        aria-label='Agent default'
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
