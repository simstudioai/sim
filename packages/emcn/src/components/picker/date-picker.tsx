'use client'

import { type ReactNode, type RefObject, useId, useRef, useState } from 'react'
import { Popover } from '@base-ui/react/popover'
import { Button } from '#emcn/components/button/button'
import { FieldFrame, fieldDescription } from '#emcn/components/field/frame'
import { Input } from '#emcn/components/field/inputs'
import { Icon } from '#emcn/components/icon/icon'
import popup from '#emcn/components/menu/popup.shared.module.css'
import { usePopoverContainer } from '#emcn/components/menu/use-popover-container'
import { Calendar, formatDay } from '#emcn/components/picker/calendar'
import styles from '#emcn/components/picker/calendar.module.css'
import picker from '#emcn/components/picker/picker.module.css'
import { useScrollEdges } from '#emcn/components/scroll-area/use-scroll-edges'

interface DatePopoverProps {
  variant?: 'field' | 'text'
  label: string
  labelHidden?: boolean
  text: string
  empty: boolean
  optional?: boolean
  disabled?: boolean
  error?: string
  hint?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  focusTarget: RefObject<HTMLButtonElement | null>
  children: ReactNode
}

function DatePopover({
  variant = 'field',
  label,
  labelHidden,
  text,
  empty,
  optional,
  disabled,
  error,
  hint,
  open,
  onOpenChange,
  focusTarget,
  children,
}: DatePopoverProps) {
  const id = useId()
  const labelId = variant === 'field' || error || hint ? `${id}-label` : undefined
  const labelledBy = labelId ? `${labelId} ${id}-value` : undefined
  const { trigger, container } = usePopoverContainer()
  const valueEdges = useScrollEdges<HTMLSpanElement>('horizontal')
  const content = (
    <Popover.Root open={open} onOpenChange={onOpenChange} modal={false}>
      {variant === 'text' ? (
        <Button
          render={
            <Popover.Trigger
              id={id}
              ref={trigger}
              aria-label={`${label}: ${text}`}
              aria-invalid={error ? true : undefined}
              aria-describedby={fieldDescription(id, error, hint)}
            />
          }
          variant='quiet'
          size='compact'
          disabled={disabled}
        >
          {text}
        </Button>
      ) : (
        <Popover.Trigger
          id={id}
          ref={trigger}
          disabled={disabled}
          aria-label={`${label}: ${text}`}
          aria-labelledby={labelledBy}
          aria-invalid={error ? true : undefined}
          aria-describedby={fieldDescription(id, error, hint)}
          className={picker.trigger}
          data-empty={empty || undefined}
          data-type='T043'
        >
          <span id={`${id}-value`} ref={valueEdges} className={picker.value}>
            {text}
          </span>
          <Icon name='I051' />
        </Popover.Trigger>
      )}
      {container && (
        <Popover.Portal container={container}>
          <Popover.Positioner
            className={popup.positioner}
            align='start'
            sideOffset={8}
            collisionPadding={8}
            positionMethod='fixed'
          >
            <Popover.Popup
              className={popup.panel}
              data-presentation='menu'
              data-material='floating'
              data-elevation='menu'
              aria-label={label}
              initialFocus={focusTarget}
            >
              <div className={styles.panel}>{children}</div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      )}
    </Popover.Root>
  )
  const control =
    variant === 'text' ? <span className={picker.inlineControl}>{content}</span> : content
  return variant === 'field' || error || hint ? (
    <FieldFrame
      id={id}
      label={label}
      labelRender={<span id={labelId} />}
      labelHidden={variant === 'text' || labelHidden}
      optional={optional}
      error={error}
      hint={hint}
    >
      {control}
    </FieldFrame>
  ) : (
    control
  )
}

interface DatePickerProps {
  label: string
  labelHidden?: boolean
  /** Controlled ISO calendar day (`YYYY-MM-DD`), where `null` holds nothing. */
  value?: string | null
  defaultValue?: string
  onValueChange?: (value: string | null) => void
  placeholder?: string
  /** Earliest and latest selectable ISO calendar days. */
  min?: string
  max?: string
  /** Offer a way back to no date. */
  clearable?: boolean
  name?: string
  optional?: boolean
  disabled?: boolean
  error?: string
  hint?: string
}

export function DatePicker({
  label,
  labelHidden,
  value,
  defaultValue,
  onValueChange,
  placeholder = 'Select date',
  min,
  max,
  clearable,
  name,
  optional,
  disabled,
  error,
  hint,
}: DatePickerProps) {
  const focusTarget = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState<string | null>(defaultValue ?? null)
  const day = value === undefined ? local : value

  function commit(next: string | null) {
    setLocal(next)
    onValueChange?.(next)
    setOpen(false)
  }

  return (
    <>
      <DatePopover
        label={label}
        labelHidden={labelHidden}
        text={day ? formatDay(day) : placeholder}
        empty={!day}
        optional={optional}
        disabled={disabled}
        error={error}
        hint={hint}
        open={open}
        onOpenChange={setOpen}
        focusTarget={focusTarget}
      >
        <Calendar
          label={label}
          start={day ?? undefined}
          min={min}
          max={max}
          focusTarget={focusTarget}
          onSelect={commit}
        />
        {clearable && day && (
          <div className={styles.footer}>
            <Button variant='quiet' size='compact' onClick={() => commit(null)}>
              Clear
            </Button>
          </div>
        )}
      </DatePopover>
      {name && <input type='hidden' name={name} value={day ?? ''} />}
    </>
  )
}

interface DateRange {
  start: string
  end: string
}

interface DateRangePickerProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  label: string
  labelHidden?: boolean
  /** `YYYY-MM-DD` days, or `YYYY-MM-DDTHH:mm` local date-times with `withTime`. */
  value: DateRange | null
  /** Return false to keep the draft open after a rejected range. */
  onValueChange: ((value: DateRange | null) => boolean) | ((value: DateRange | null) => void)
  placeholder?: string
  min?: string
  max?: string
  withTime?: boolean
  clearable?: boolean
  disabled?: boolean
  error?: string
  hint?: string
}

const DAY_START = '00:00'
const DAY_END = '23:59'

interface StagedDateTime {
  day?: string
  time: string
}

function splitDateTime(value: string | undefined, fallbackTime: string): StagedDateTime {
  const [day, time] = value?.split('T') ?? []
  return { day, time: time ?? fallbackTime }
}

function stagedRange(value: DateRange | null) {
  return {
    start: splitDateTime(value?.start, DAY_START),
    end: splitDateTime(value?.end, DAY_END),
  }
}

function rangeText({ start, end }: DateRange) {
  const describe = (value: string) => {
    const [day, time] = value.split('T')
    return time ? `${formatDay(day)} ${time}` : formatDay(day)
  }
  return `${describe(start)} – ${describe(end)}`
}

/** Days are staged in the popup and committed together by Apply; Escape discards them. */
export function DateRangePicker({
  open: controlledOpen,
  onOpenChange,
  label,
  labelHidden,
  value,
  onValueChange,
  placeholder = 'Select date range',
  min,
  max,
  withTime,
  clearable,
  disabled,
  error,
  hint,
}: DateRangePickerProps) {
  const focusTarget = useRef<HTMLButtonElement>(null)
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const [draft, setDraft] = useState(() => stagedRange(value))

  function changeOpen(next: boolean) {
    if (next) setDraft(stagedRange(value))
    if (controlledOpen === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }

  function pick(day: string) {
    setDraft(({ start, end }) => {
      if (!start.day || end.day)
        return { start: { ...start, day }, end: { ...end, day: undefined } }
      return day < start.day
        ? { start: { ...start, day }, end: { ...end, day: start.day } }
        : { start, end: { ...end, day } }
    })
  }

  function commit(next: DateRange | null) {
    if (onValueChange(next) !== false) changeOpen(false)
  }

  function apply() {
    const { start, end } = draft
    if (!start.day || !end.day) return
    commit(
      withTime
        ? { start: `${start.day}T${start.time}`, end: `${end.day}T${end.time}` }
        : { start: start.day, end: end.day }
    )
  }

  return (
    <DatePopover
      variant='text'
      label={label}
      labelHidden={labelHidden}
      text={value ? rangeText(value) : placeholder}
      empty={!value}
      disabled={disabled}
      error={error}
      hint={hint}
      open={open}
      onOpenChange={changeOpen}
      focusTarget={focusTarget}
    >
      <Calendar
        label={label}
        start={draft.start.day}
        end={draft.end.day}
        min={min}
        max={max}
        focusTarget={focusTarget}
        onSelect={pick}
      />
      {withTime && (
        <div className={styles.times}>
          <Input
            placeholder='09:00'
            type='time'
            label='Start time'
            value={draft.start.time}
            onChange={(time) => setDraft((d) => ({ ...d, start: { ...d.start, time } }))}
          />
          <Input
            placeholder='10:00'
            type='time'
            label='End time'
            value={draft.end.time}
            onChange={(time) => setDraft((d) => ({ ...d, end: { ...d.end, time } }))}
          />
        </div>
      )}
      <div className={styles.footer}>
        {clearable && value && (
          <Button variant='quiet' size='compact' onClick={() => commit(null)}>
            Clear
          </Button>
        )}
        <Button
          variant='primary'
          size='compact'
          disabled={!draft.start.day || !draft.end.day}
          onClick={apply}
        >
          Apply
        </Button>
      </div>
    </DatePopover>
  )
}
