'use client'

import { useId, useMemo } from 'react'
import {
  ChipInput,
  ChipSelect,
  type ChipSelectOption,
  ChipTextarea,
  Label,
  Switch,
} from '@sim/emcn'
import type { FormField } from '@/lib/interfaces'
import { INTERFACE_LAYOUT_LIMITS } from '@/lib/interfaces/constants'

/**
 * Distinct, non-empty choices for a dropdown field. Empty and duplicate
 * options are dropped because the select keys its rows by value; both are
 * transient states the builder can produce mid-edit.
 */
function toSelectOptions(options: readonly string[] | undefined): ChipSelectOption[] {
  const choices: ChipSelectOption[] = []
  const seen = new Set<string>()
  for (const option of options ?? []) {
    if (option.length === 0 || seen.has(option)) continue
    seen.add(option)
    choices.push({ value: option, label: option })
  }
  return choices
}

export interface FormFieldControlProps {
  field: FormField
  value: string | boolean | undefined
  onChange: (value: string | boolean) => void
  error?: string
  disabled?: boolean
}

/**
 * One rendered form field — label, control, and the hint/error line beneath
 * it. Uses the chip-field rhythm (`gap-[9px]`, muted normal-weight label,
 * `text-caption` message) so an interface form reads exactly like every other
 * labeled field surface in the app.
 */
export function FormFieldControl({
  field,
  value,
  onChange,
  error,
  disabled,
}: FormFieldControlProps) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`

  const selectOptions = useMemo(() => toSelectOptions(field.options), [field.options])

  const aria = {
    'aria-required': field.required || undefined,
    'aria-invalid': Boolean(error) || undefined,
    'aria-describedby': error ? errorId : field.hint ? hintId : undefined,
  } as const

  const label = (
    <Label htmlFor={id} className='pl-0.5 font-normal text-[var(--text-muted)]'>
      {field.label}
      {field.required && (
        <span aria-hidden className='ml-0.5 text-[var(--text-error)]'>
          *
        </span>
      )}
    </Label>
  )

  const message = error ? (
    <p id={errorId} role='alert' className='text-[var(--text-error)] text-caption'>
      {error}
    </p>
  ) : field.hint ? (
    <p id={hintId} className='text-[var(--text-muted)] text-caption'>
      {field.hint}
    </p>
  ) : null

  if (field.type === 'switch') {
    return (
      <div className='flex flex-col gap-[9px]'>
        <div className='flex items-center justify-between gap-3'>
          {label}
          <Switch
            id={id}
            checked={value === true}
            onCheckedChange={(next) => onChange(next === true)}
            disabled={disabled}
            {...aria}
          />
        </div>
        {message}
      </div>
    )
  }

  const textValue = typeof value === 'string' ? value : ''

  return (
    <div className='flex flex-col gap-[9px]'>
      {label}
      {field.type === 'long-text' ? (
        <ChipTextarea
          id={id}
          rows={4}
          value={textValue}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          maxLength={INTERFACE_LAYOUT_LIMITS.MAX_FORM_VALUE_LENGTH}
          error={Boolean(error)}
          disabled={disabled}
          {...aria}
        />
      ) : field.type === 'dropdown' ? (
        <ChipSelect
          options={selectOptions}
          value={textValue}
          onChange={onChange}
          placeholder={field.placeholder || 'Select an option'}
          align='start'
          fullWidth
          dropdownWidth='trigger'
          disabled={disabled}
          aria-label={field.label}
        />
      ) : (
        <ChipInput
          id={id}
          value={textValue}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          maxLength={INTERFACE_LAYOUT_LIMITS.MAX_FORM_VALUE_LENGTH}
          error={Boolean(error)}
          disabled={disabled}
          {...aria}
        />
      )}
      {message}
    </div>
  )
}
