'use client'

import { ChipCombobox, type ComboboxOptionGroup } from '@sim/emcn'
import { TOOL_MODELS } from '@/app/(landing)/models/tools'
import { MODEL_PROVIDERS_WITH_CATALOGS } from '@/app/(landing)/models/utils'

const TOOL_MODEL_IDS = new Set(TOOL_MODELS.map((model) => model.id))

const MODEL_OPTION_GROUPS: ComboboxOptionGroup[] = MODEL_PROVIDERS_WITH_CATALOGS.map(
  (provider) => ({
    section: provider.name,
    items: provider.models
      .filter((model) => TOOL_MODEL_IDS.has(model.id))
      .map((model) => ({ label: model.displayName, value: model.id, icon: provider.icon })),
  })
).filter((group) => group.items.length > 0)

interface ModelMultiSelectProps {
  /** Id of the visible label element naming the picker. */
  labelId: string
  value: string[]
  onChange: (modelIds: string[]) => void
}

/** Searchable, provider-grouped picker over every current first-party catalog model. */
export function ModelMultiSelect({ labelId, value, onChange }: ModelMultiSelectProps) {
  return (
    <ChipCombobox
      aria-labelledby={labelId}
      options={[]}
      groups={MODEL_OPTION_GROUPS}
      multiSelect
      multiSelectValues={value}
      onMultiSelectChange={onChange}
      searchable
      searchPlaceholder='Search models…'
      placeholder='Select models'
      emptyMessage='No models match'
      maxHeight={360}
    />
  )
}
