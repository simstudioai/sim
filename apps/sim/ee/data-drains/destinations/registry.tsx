'use client'

import { ChipInput, ChipSelect, ChipTextarea, SecretInput, Switch } from '@sim/emcn'
import type { DestinationType } from '@/lib/data-drains/types'
import { SettingRow } from '@/ee/components/setting-row'
import {
  DESTINATION_SPECS,
  type DestinationField,
  type DestinationFormSpec,
  type DestinationState,
} from '@/ee/data-drains/destinations/specs'

interface FormFieldsProps {
  state: DestinationState
  setState: (state: DestinationState) => void
}

function DestinationFormField({
  field,
  state,
  setState,
}: FormFieldsProps & { field: DestinationField<DestinationState> }) {
  if (field.kind === 'note') {
    return <p className='text-[var(--text-muted)] text-caption'>{field.text}</p>
  }
  const set = (value: string | boolean) => setState({ ...state, [field.key]: value })
  if (field.kind === 'select') {
    return (
      <SettingRow label={field.label}>
        <ChipSelect
          aria-label={field.label}
          value={String(state[field.key])}
          onChange={set}
          options={[...field.options]}
          align='start'
        />
      </SettingRow>
    )
  }
  return (
    <SettingRow label={field.label} htmlFor={field.id}>
      {field.kind === 'switch' ? (
        <Switch id={field.id} checked={Boolean(state[field.key])} onCheckedChange={set} />
      ) : field.kind === 'secret' ? (
        <SecretInput
          id={field.id}
          value={String(state[field.key])}
          onChange={set}
          placeholder={field.placeholder}
        />
      ) : field.kind === 'text' ? (
        <ChipInput
          id={field.id}
          value={String(state[field.key])}
          onChange={(e) => set(e.target.value)}
          placeholder={field.placeholder}
        />
      ) : (
        <ChipTextarea
          id={field.id}
          value={String(state[field.key])}
          onChange={(e) => set(e.target.value)}
          placeholder={field.placeholder}
          rows={6}
        />
      )}
    </SettingRow>
  )
}

function FormFields({
  spec,
  state,
  setState,
}: FormFieldsProps & { spec: DestinationFormSpec<DestinationState> }) {
  return (
    <>
      {spec.fields.map((field) => (
        <DestinationFormField
          key={field.kind === 'note' ? field.text : field.key}
          field={field}
          state={state}
          setState={setState}
        />
      ))}
    </>
  )
}

/** The destination specs with their legacy field rendering attached. */
export const DESTINATION_FORM_REGISTRY = Object.fromEntries(
  Object.entries(DESTINATION_SPECS).map(([type, spec]) => [
    type,
    {
      ...spec,
      FormFields: ({ state, setState }: FormFieldsProps) => (
        <FormFields spec={spec} state={state} setState={setState} />
      ),
    },
  ])
) as Record<
  DestinationType,
  DestinationFormSpec<DestinationState> & {
    FormFields: (props: FormFieldsProps) => React.ReactNode
  }
>
