'use client'

import { useId, useMemo } from 'react'
import {
  Chip,
  ChipInput,
  ChipSelect,
  type ChipSelectOption,
  ChipTextarea,
  chipContentGap,
  chipContentIconClass,
  cn,
  Label,
  Switch,
} from '@sim/emcn'
import { GripVertical, X } from '@sim/emcn/icons'
import type { FormField } from '@/lib/interfaces'
import { INTERFACE_LAYOUT_LIMITS } from '@/lib/interfaces/constants'

/** Shown by a field that has no placeholder of its own. */
const DEFAULT_FIELD_PLACEHOLDER = 'Type something...'

/**
 * The 2px optical inset a field's title carries, authored or rendered. Declared
 * once because the whole point is that the two agree — a drift here shows up as
 * the title jumping sideways when the builder toggles edit → preview.
 */
const LABEL_INSET = 'pl-0.5'

/**
 * The label editor while authoring: a bare input carrying the chip field's
 * geometry and typography but none of its surface, so the title reads as the
 * label it will become rather than as one more form control. Composed from chip
 * tokens — `h-[30px]` is `chipGeometryClass`'s own height — so it keeps the
 * footprint of the control it replaced.
 *
 * `pl-0.5` is {@link LABEL_INSET}, the same 2px the rendered `<Label>` below
 * carries: the authored title and the shipped label then sit on exactly the
 * same x, so toggling edit → preview does not nudge the text sideways.
 */
const INVISIBLE_TITLE_INPUT_CLASS = cn(
  'h-[30px] w-full min-w-0 flex-1 bg-transparent pr-2 text-[var(--text-body)] text-sm outline-none placeholder:text-[var(--text-muted)]',
  LABEL_INSET
)

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

/**
 * The authoring affordances a field carries when the builder is editing the
 * form on the canvas. Present only in edit mode for a viewer who can write, so
 * a filled-in form never renders them rather than rendering them disabled.
 *
 * Deliberately narrow: the label is the one property worth editing where the
 * field is *seen*, because it is the only one a visitor reads. Type, name,
 * placeholder, hint, required, options, and default are invisible on the
 * rendered field and stay in the inspector, which carries all of them.
 *
 * Reordering is not in here: the row is dragged, exactly like a module on the
 * canvas, and the surrounding list owns that wiring via `useDragReorder`.
 */
export interface FormFieldEditing {
  onLabelChange: (label: string) => void
  onRemove: () => void
}

export interface FormFieldControlProps {
  field: FormField
  value: string | boolean | undefined
  onChange: (value: string | boolean) => void
  error?: string
  disabled?: boolean
  /** Authoring affordances — absent means this is a field being filled in, not authored. */
  editing?: FormFieldEditing
}

/**
 * One rendered form field — label, control, and the hint/error line beneath
 * it. Uses the chip-field rhythm (`gap-[9px]`, muted normal-weight label,
 * `text-caption` message) so an interface form reads exactly like every other
 * labeled field surface in the app.
 *
 * While authoring, the static label becomes an editable title — a bare input
 * with no surface of its own, so the row still reads as a label rather than as
 * a second form control — flanked by a drag grip and a remove chip. The control
 * beneath is the real one either way — a builder sees the input a visitor will
 * see, at the size they will see it — but it is inert while authoring because
 * edit mode never submits.
 */
export function FormFieldControl({
  field,
  value,
  onChange,
  error,
  disabled,
  editing,
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

  const fieldName = field.label.trim() || field.name.trim() || 'Untitled field'

  const label = editing ? (
    <div className={cn('group/field flex items-center', chipContentGap)}>
      {/**
       * The title leads the row, at the same inset the rendered label uses —
       * the grip sat here first and pushed the whole title out of line with the
       * field it names.
       */}
      <input
        value={field.label}
        onChange={(event) => editing.onLabelChange(event.target.value)}
        placeholder='Field label'
        maxLength={INTERFACE_LAYOUT_LIMITS.MAX_FIELD_LABEL_LENGTH}
        aria-label={`Label for ${fieldName}`}
        className={INVISIBLE_TITLE_INPUT_CLASS}
      />
      <GripVertical
        aria-hidden
        className={cn(
          chipContentIconClass,
          'cursor-grab opacity-0 transition-opacity group-hover/field:opacity-100'
        )}
      />
      {/**
       * `type='submit'` is the HTML default, and this sits inside the rendered
       * `<form>` — without an explicit type, removing a field would submit it.
       * `Chip` already defaults to `button`, which is why no type is passed.
       */}
      <Chip
        flush
        leftIcon={X}
        onClick={editing.onRemove}
        aria-label={`Remove ${fieldName}`}
        className='shrink-0'
      />
    </div>
  ) : (
    <Label htmlFor={id} className={cn('font-normal text-[var(--text-muted)]', LABEL_INSET)}>
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

  /**
   * Authoring puts the label input on its own row, so the switch drops out of
   * its inline layout and stacks like every other type — one shape to reason
   * about while composing.
   */
  if (field.type === 'switch' && !editing) {
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
      {field.type === 'switch' ? (
        <Switch
          id={id}
          checked={value === true}
          onCheckedChange={(next) => onChange(next === true)}
          disabled={disabled}
          {...aria}
        />
      ) : field.type === 'long-text' ? (
        <ChipTextarea
          id={id}
          rows={4}
          value={textValue}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder || DEFAULT_FIELD_PLACEHOLDER}
          maxLength={INTERFACE_LAYOUT_LIMITS.MAX_FORM_VALUE_LENGTH}
          error={Boolean(error)}
          disabled={disabled}
          {...aria}
        />
      ) : field.type === 'dropdown' ? (
        <ChipSelect
          id={id}
          options={selectOptions}
          value={textValue}
          onChange={onChange}
          placeholder={field.placeholder || 'Select an option'}
          align='start'
          fullWidth
          dropdownWidth='trigger'
          disabled={disabled}
          aria-label={field.label}
          {...aria}
        />
      ) : (
        <ChipInput
          id={id}
          value={textValue}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder || DEFAULT_FIELD_PLACEHOLDER}
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
