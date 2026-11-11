'use client'

import { SwitchField, TextField } from '@sim/emcn/field'
import { SettingsSection } from '@sim/emcn/settings-section'
import { FieldStack, Muted } from '@/app/(product)/_components/settings-parts/settings-parts'
import type { CustomBlockInput } from '@/platform/lib/data/custom-blocks'

type InputPatch = Partial<Pick<CustomBlockInput, 'placeholder' | 'required'>>

interface BlockInputsProps {
  /** The deployed state is still loading, so the inputs are not known yet. */
  loading: boolean
  inputs: readonly CustomBlockInput[]
  disabled: boolean
  onChange: (inputId: string, patch: InputPatch) => void
}

/**
 * Every deployed Start input, exposed as is: its name, type and description come from the field,
 * and only whether consumers must fill it and the hint its empty field shows are authored here.
 */
export function BlockInputs({ loading, inputs, disabled, onChange }: BlockInputsProps) {
  return (
    <SettingsSection title='Inputs'>
      <FieldStack>
        {!loading && inputs.length === 0 && (
          <Muted>This workflow’s Start block has no inputs</Muted>
        )}
        {!loading &&
          inputs.map((input) => (
            <InputOverride
              key={input.id}
              input={input}
              disabled={disabled}
              onChange={(patch) => onChange(input.id, patch)}
            />
          ))}
      </FieldStack>
    </SettingsSection>
  )
}

interface InputOverrideProps {
  input: CustomBlockInput
  disabled: boolean
  onChange: (patch: InputPatch) => void
}

function InputOverride({ input, disabled, onChange }: InputOverrideProps) {
  return (
    <>
      <TextField
        label={`${input.name} (${input.type})`}
        value={input.placeholder ?? ''}
        onChange={(placeholder) => onChange({ placeholder })}
        placeholder={input.description || 'Shown in the empty field'}
        maxLength={200}
        disabled={disabled}
      />
      <SwitchField
        label={`${input.name} required`}
        checked={input.required ?? false}
        onCheckedChange={(required) => onChange({ required })}
        disabled={disabled}
      />
    </>
  )
}
