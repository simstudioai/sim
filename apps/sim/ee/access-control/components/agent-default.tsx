'use client'

import { useMemo, useState } from 'react'
import { ChipCombobox, type ComboboxOption } from '@sim/emcn-legacy'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import {
  REGISTRY_MODEL_FACTS,
  resolveAgentDefaultModel,
} from '@/lib/permission-groups/model-access'
import { agentDefaultModelIds, PLATFORM_DEFAULT_MODEL } from '@/ee/access-control/lib/editor'
import { SettingRow } from '@/ee/components/setting-row'
import { useProviderModelLists } from '@/hooks/queries/providers'
import {
  DYNAMIC_MODEL_PROVIDERS,
  getProviderIcon,
  getProviderModels,
  SIM_AUTO_MODEL_ID,
} from '@/providers/models'
import type { ProviderId } from '@/providers/types'

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
    const { autoAllowed, models } = agentDefaultModelIds({
      config,
      providerIds,
      staticModels: getProviderModels,
      dynamicModels,
      hosted,
      facts: REGISTRY_MODEL_FACTS,
    })
    const modelOptions: ComboboxOption[] = [
      { label: 'Platform default', value: PLATFORM_DEFAULT_MODEL },
      ...(autoAllowed ? [{ label: 'Auto', value: SIM_AUTO_MODEL_ID }] : []),
      ...models.map((model) => ({
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
        value={config.defaultAgentModel ?? PLATFORM_DEFAULT_MODEL}
        onChange={(model) => onChange(model === PLATFORM_DEFAULT_MODEL ? null : model)}
        placeholder='Select a model'
        searchable
        error={error}
        onOpenChange={setOpen}
        className='w-full'
      />
    </SettingRow>
  )
}
