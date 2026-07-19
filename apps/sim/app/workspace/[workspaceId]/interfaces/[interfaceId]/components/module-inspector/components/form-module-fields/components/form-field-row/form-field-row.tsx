'use client'

import { type ComponentType, useMemo } from 'react'
import {
  Button,
  Chip,
  ChipDropdown,
  ChipInput,
  ChipSelect,
  type ChipSelectOption,
  ChipTextarea,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Switch,
} from '@sim/emcn'
import {
  ArrowDown,
  ArrowUp,
  ListFilter,
  MoreHorizontal,
  Plus,
  Rows3,
  Trash,
  TypeBoolean,
  TypeText,
  X,
} from '@sim/emcn/icons'
import { omit } from '@sim/utils/object'
import { INTERFACE_LAYOUT_LIMITS } from '@/lib/interfaces/constants'
import type { FormField, FormFieldType } from '@/lib/interfaces/types'
import { InspectorField } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/inspector-field'
import { deriveFormFieldErrors } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/module-inspector/components/form-module-fields/utils'

/**
 * The four field types a form module can collect, in builder order. Each entry
 * carries the glyph shown in the type dropdown.
 */
const FORM_FIELD_TYPE_OPTIONS = [
  { value: 'short-text', label: 'Short text', icon: TypeText },
  { value: 'long-text', label: 'Long text', icon: Rows3 },
  { value: 'dropdown', label: 'Dropdown', icon: ListFilter },
  { value: 'switch', label: 'Switch', icon: TypeBoolean },
] as const satisfies ReadonlyArray<{
  value: FormFieldType
  label: string
  icon: ComponentType<{ className?: string }>
}>

const EMPTY_OPTIONS: readonly string[] = []

/**
 * `Option N` for the lowest `N` no sibling option already uses. Duplicates are
 * legal on the wire but collapse in the rendered select, so they are avoided.
 */
function nextOptionLabel(options: readonly string[]): string {
  const taken = new Set(options)
  let index = options.length + 1
  while (taken.has(`Option ${index}`)) index += 1
  return `Option ${index}`
}

function isFormFieldType(value: string): value is FormFieldType {
  return FORM_FIELD_TYPE_OPTIONS.some((option) => option.value === value)
}

/**
 * Distinct, non-empty options for the "default value" picker. Duplicates are
 * dropped because the select keys its rows by value.
 */
function toDefaultValueChoices(options: readonly string[]): ChipSelectOption[] {
  const choices: ChipSelectOption[] = [{ value: '', label: 'None' }]
  const seen = new Set<string>()
  for (const option of options) {
    if (option.length === 0 || seen.has(option)) continue
    seen.add(option)
    choices.push({ value: option, label: option })
  }
  return choices
}

export interface FormFieldRowProps {
  field: FormField
  /** Whether another field in the module already uses this field's name. */
  duplicateName: boolean
  onChange: (next: FormField) => void
  onRemove: () => void
  onMove: (direction: 'up' | 'down') => void
  canMoveUp: boolean
  canMoveDown: boolean
  disabled?: boolean
}

/**
 * One editable field definition inside the form module's inspector. Fully
 * controlled — every edit is reported through `onChange`, and the section
 * decides whether the resulting config is valid enough to persist.
 */
export function FormFieldRow({
  field,
  duplicateName,
  onChange,
  onRemove,
  onMove,
  canMoveUp,
  canMoveDown,
  disabled,
}: FormFieldRowProps) {
  const options = field.options ?? EMPTY_OPTIONS
  const errors = deriveFormFieldErrors(field, duplicateName)
  const headerLabel = field.label.trim() || field.name.trim() || 'Untitled field'

  const defaultValueChoices = useMemo(() => toDefaultValueChoices(options), [options])

  /**
   * Switching type invalidates a default seeded for the previous control — a
   * boolean on a text field, or a dropdown value that is no longer an option.
   */
  function handleTypeChange(nextType: FormFieldType): void {
    if (nextType === field.type) return
    let next: FormField = { ...field, type: nextType }
    if (nextType === 'dropdown' && options.length === 0) {
      next = { ...next, options: [nextOptionLabel(EMPTY_OPTIONS)] }
    }
    const nextOptions = next.options ?? EMPTY_OPTIONS
    const defaultStillFits =
      next.defaultValue === undefined ||
      (nextType === 'switch'
        ? typeof next.defaultValue === 'boolean'
        : typeof next.defaultValue === 'string' &&
          (nextType !== 'dropdown' || nextOptions.includes(next.defaultValue)))
    onChange(defaultStillFits ? next : omit(next, ['defaultValue']))
  }

  function handleDefaultValueChange(next: string | boolean): void {
    if (next === '') {
      onChange(omit(field, ['defaultValue']))
      return
    }
    onChange({ ...field, defaultValue: next })
  }

  function handleOptionChange(index: number, next: string): void {
    onChange({ ...field, options: options.map((option, i) => (i === index ? next : option)) })
  }

  function handleOptionRemove(index: number): void {
    onChange({ ...field, options: options.filter((_, i) => i !== index) })
  }

  function handleOptionAdd(): void {
    if (options.length >= INTERFACE_LAYOUT_LIMITS.MAX_OPTIONS) return
    onChange({ ...field, options: [...options, nextOptionLabel(options)] })
  }

  return (
    <div className='flex flex-col gap-3 rounded-[10px] border border-[var(--border)] p-2'>
      <div className='flex items-center justify-between gap-2'>
        <span className='min-w-0 flex-1 truncate pl-0.5 font-medium text-[var(--text-primary)] text-small'>
          {headerLabel}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              disabled={disabled}
              className='!p-1 size-7 shrink-0'
              aria-label={`Actions for ${headerLabel}`}
            >
              <MoreHorizontal className='size-[14px]' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' sideOffset={4}>
            <DropdownMenuItem disabled={!canMoveUp} onSelect={() => onMove('up')}>
              <ArrowUp />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canMoveDown} onSelect={() => onMove('down')}>
              <ArrowDown />
              Move down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onRemove}>
              <Trash />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <InspectorField title='Type'>
        <ChipDropdown
          value={field.type}
          onChange={(next) => {
            if (isFormFieldType(next)) handleTypeChange(next)
          }}
          options={FORM_FIELD_TYPE_OPTIONS}
          align='start'
          fullWidth
          disabled={disabled}
          aria-label={`Type for ${headerLabel}`}
        />
      </InspectorField>

      <InspectorField title='Label' required error={errors.label}>
        {(control) => (
          <ChipInput
            value={field.label}
            onChange={(event) => onChange({ ...field, label: event.target.value })}
            placeholder='Shown above the input'
            maxLength={INTERFACE_LAYOUT_LIMITS.MAX_FIELD_LABEL_LENGTH}
            error={Boolean(errors.label)}
            disabled={disabled}
            {...control}
          />
        )}
      </InspectorField>

      <InspectorField
        title='Name'
        required
        error={errors.name}
        hint='The workflow start-block input key this field fills.'
      >
        {(control) => (
          <ChipInput
            value={field.name}
            onChange={(event) => onChange({ ...field, name: event.target.value })}
            inputClassName='font-mono'
            spellCheck={false}
            autoComplete='off'
            maxLength={INTERFACE_LAYOUT_LIMITS.MAX_FIELD_NAME_LENGTH}
            error={Boolean(errors.name)}
            disabled={disabled}
            {...control}
          />
        )}
      </InspectorField>

      {field.type !== 'switch' && (
        <InspectorField title='Placeholder'>
          {(control) => (
            <ChipInput
              value={field.placeholder ?? ''}
              onChange={(event) => onChange({ ...field, placeholder: event.target.value })}
              maxLength={INTERFACE_LAYOUT_LIMITS.MAX_PLACEHOLDER_LENGTH}
              disabled={disabled}
              {...control}
            />
          )}
        </InspectorField>
      )}

      <InspectorField title='Hint'>
        {(control) => (
          <ChipInput
            value={field.hint ?? ''}
            onChange={(event) => onChange({ ...field, hint: event.target.value })}
            placeholder='Shown under the input'
            maxLength={INTERFACE_LAYOUT_LIMITS.MAX_HINT_LENGTH}
            disabled={disabled}
            {...control}
          />
        )}
      </InspectorField>

      <InspectorField title='Required' orientation='inline'>
        {(control) => (
          <Switch
            checked={field.required}
            onCheckedChange={(next) => onChange({ ...field, required: next === true })}
            disabled={disabled}
            {...control}
          />
        )}
      </InspectorField>

      {field.type === 'dropdown' && (
        <InspectorField title='Options' required error={errors.options}>
          <div className='flex flex-col gap-2'>
            {options.map((option, index) => (
              <div key={index} className='flex items-center gap-1.5'>
                <ChipInput
                  value={option}
                  onChange={(event) => handleOptionChange(index, event.target.value)}
                  maxLength={INTERFACE_LAYOUT_LIMITS.MAX_OPTION_LENGTH}
                  error={option.length === 0}
                  disabled={disabled}
                  className='min-w-0 flex-1'
                  aria-label={`Option ${index + 1}`}
                />
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  disabled={disabled}
                  onClick={() => handleOptionRemove(index)}
                  className='!p-1 size-7 shrink-0'
                  aria-label={`Remove option ${index + 1}`}
                >
                  <X className='size-[14px]' />
                </Button>
              </div>
            ))}
            <Chip
              leftIcon={Plus}
              onClick={handleOptionAdd}
              fullWidth
              flush
              disabled={disabled || options.length >= INTERFACE_LAYOUT_LIMITS.MAX_OPTIONS}
            >
              Add option
            </Chip>
          </div>
        </InspectorField>
      )}

      {field.type === 'switch' ? (
        <InspectorField title='Default on' orientation='inline'>
          {(control) => (
            <Switch
              checked={field.defaultValue === true}
              onCheckedChange={(next) => handleDefaultValueChange(next === true)}
              disabled={disabled}
              {...control}
            />
          )}
        </InspectorField>
      ) : field.type === 'dropdown' ? (
        <InspectorField title='Default'>
          <ChipSelect
            options={defaultValueChoices}
            value={typeof field.defaultValue === 'string' ? field.defaultValue : ''}
            onChange={handleDefaultValueChange}
            placeholder='None'
            align='start'
            fullWidth
            dropdownWidth='trigger'
            disabled={disabled}
            aria-label={`Default value for ${headerLabel}`}
          />
        </InspectorField>
      ) : (
        <InspectorField title='Default'>
          {(control) =>
            field.type === 'long-text' ? (
              <ChipTextarea
                rows={2}
                value={typeof field.defaultValue === 'string' ? field.defaultValue : ''}
                onChange={(event) => handleDefaultValueChange(event.target.value)}
                maxLength={INTERFACE_LAYOUT_LIMITS.MAX_DEFAULT_VALUE_LENGTH}
                disabled={disabled}
                {...control}
              />
            ) : (
              <ChipInput
                value={typeof field.defaultValue === 'string' ? field.defaultValue : ''}
                onChange={(event) => handleDefaultValueChange(event.target.value)}
                maxLength={INTERFACE_LAYOUT_LIMITS.MAX_DEFAULT_VALUE_LENGTH}
                disabled={disabled}
                {...control}
              />
            )
          }
        </InspectorField>
      )}
    </div>
  )
}
