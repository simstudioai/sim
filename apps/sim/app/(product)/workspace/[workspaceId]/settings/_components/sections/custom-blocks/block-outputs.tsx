'use client'

import { TextField } from '@sim/emcn/field'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SettingsSection } from '@sim/emcn/settings-section'
import { FieldStack } from '@/app/(product)/_components/settings-parts/settings-parts'

/** One exposed output, keyed by its source block and path. */
export interface BlockOutputField {
  key: string
  label: string
  name: string
}

interface BlockOutputsProps {
  options: readonly { value: string; label: string }[]
  outputs: readonly BlockOutputField[]
  /** The picker cannot change: no deployed outputs yet, a save underway, or a read-only viewer. */
  pickerDisabled: boolean
  disabled: boolean
  onOutputsChange: (keys: string[]) => void
  onNameChange: (key: string, name: string) => void
}

/** The deployed outputs a block exposes, at least one, each under a name consumers reference. */
export function BlockOutputs({
  options,
  outputs,
  pickerDisabled,
  disabled,
  onOutputsChange,
  onNameChange,
}: BlockOutputsProps) {
  return (
    <SettingsSection title='Outputs'>
      <FieldStack>
        <MultiSelect
          label='Outputs (at least one)'
          options={options}
          value={outputs.map((output) => output.key)}
          onValueChange={onOutputsChange}
          placeholder='Select outputs'
          searchLabel='Search outputs'
          disabled={pickerDisabled}
        />
        {outputs.map((output) => (
          <TextField
            key={output.key}
            label={output.label}
            value={output.name}
            onChange={(next) => onNameChange(output.key, next)}
            placeholder='name'
            maxLength={60}
            disabled={disabled}
          />
        ))}
      </FieldStack>
    </SettingsSection>
  )
}
