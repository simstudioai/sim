'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Calendar,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverAnchor,
  PopoverContent,
  toast,
} from '@sim/emcn'
import { Check } from '@sim/emcn/icons'
import type { ColumnDefinition } from '@/lib/table'
import { columnTypeOf } from '@/lib/table/column-types'
import { isCalendarDateString } from '@/lib/table/dates'
import { getTimezoneEditBlockedMessage } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/timezone-editing'
import { useTimezoneState } from '@/hooks/queries/general-settings'
import type { SaveReason } from '../../../types'
import {
  cleanCellValue,
  dateValueToLocalParts,
  displayToStorage,
  formatValueForInput,
  storageToDisplay,
  todayLocalCalendarDate,
} from '../../../utils'
import { SelectPill, selectedOptionIds } from '../../select-field'

interface InlineEditorProps {
  value: unknown
  column: ColumnDefinition
  initialCharacter?: string
  onSave: (value: unknown, reason: SaveReason) => void
  onCancel: () => void
}

/**
 * Produces the raw draft that the column type will coerce on save. Ordinary
 * date columns keep their display parser for partial dates; other date-editor
 * types receive the untouched draft so their own safety rules are not erased.
 */
export function dateEditorRawValue(
  draft: string,
  column: ColumnDefinition,
  timeZone: string,
  storageValue?: string
): string {
  if (storageValue !== undefined) return storageValue
  return column.type === 'date' ? (displayToStorage(draft, timeZone) ?? draft) : draft
}

/** Redirect wheel gestures over an inline editor to the surrounding table scroll container. */
function handleEditorWheel(e: React.WheelEvent<HTMLInputElement>) {
  e.preventDefault()
  const container = e.currentTarget.closest('[data-table-scroll]') as HTMLElement | null
  if (container) {
    container.scrollBy(e.deltaX, e.deltaY)
  }
}

/**
 * Inline editor for `date` columns — text input + popover with a calendar and
 * a time field. Picking a day on a date-only value commits immediately (the
 * pick fully determines the value); when the value carries a time, picker
 * edits update the draft in place — the day pick keeps the time-of-day
 * (including seconds), the time field keeps the day — and Enter/blur commits.
 */
function InlineDateEditor(props: InlineEditorProps) {
  const { onCancel } = props
  const timezoneState = useTimezoneState()
  const timezoneUnavailable = timezoneState.status !== 'ready'
  const timezoneBlockedMessage = getTimezoneEditBlockedMessage(timezoneState)

  useEffect(() => {
    if (timezoneState.status !== 'error' && timezoneState.status !== 'invalid') return
    if (timezoneBlockedMessage) toast.error(timezoneBlockedMessage)
    onCancel()
  }, [onCancel, timezoneBlockedMessage, timezoneState.status])

  if (timezoneUnavailable) {
    return (
      <span role='status' className='w-full min-w-0 truncate text-[var(--text-muted)] text-small'>
        {timezoneState.status === 'loading'
          ? 'Loading timezone…'
          : timezoneState.status === 'invalid'
            ? 'Invalid timezone'
            : 'Timezone unavailable'}
      </span>
    )
  }

  return <ReadyInlineDateEditor {...props} initialTimeZone={timezoneState.timezone} />
}

interface ReadyInlineDateEditorProps extends InlineEditorProps {
  initialTimeZone: string
}

function ReadyInlineDateEditor({
  value,
  column,
  initialCharacter,
  onSave,
  onCancel,
  initialTimeZone,
}: ReadyInlineDateEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef(false)
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** Timestamp of the last pointerdown inside the popover — blur-save skips
   *  and refocuses while a popover interaction is in flight (covers browsers
   *  where buttons don't take focus on click). */
  const popoverPointerAtRef = useRef(0)
  /** Keep one wall-clock interpretation for the lifetime of this edit. */
  const editTimeZoneRef = useRef(initialTimeZone)
  const timeZone = editTimeZoneRef.current

  const storedValue = formatValueForInput(value, column.type, timeZone)
  const initialDraft =
    initialCharacter !== undefined
      ? initialCharacter
      : storageToDisplay(storedValue, { seconds: true })
  const [draft, setDraft] = useState(initialDraft)
  const [invalid, setInvalid] = useState(false)
  /** Picker commits mutate the draft from timeouts/child handlers; reading it
   *  through a ref keeps the scheduled blur-save from saving a stale draft. */
  const draftRef = useRef(draft)
  draftRef.current = draft

  /** The calendar works on wall times; feed it the draft's literal wall
   *  representation. */
  const draftParts = dateValueToLocalParts(displayToStorage(draft, timeZone) ?? storedValue)
  const pickerValue = draftParts.day
    ? draftParts.time
      ? `${draftParts.day}T${draftParts.time}`
      : draftParts.day
    : undefined

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    if (initialCharacter !== undefined) {
      const len = input.value.length
      input.setSelectionRange(len, len)
    } else {
      input.select()
    }
  }, [])

  useEffect(() => () => clearTimeout(blurTimeoutRef.current), [])

  const doSave = useCallback(
    (reason: SaveReason, storageVal?: string) => {
      if (doneRef.current) return
      clearTimeout(blurTimeoutRef.current)
      const current = draftRef.current
      // Untouched draft → re-save the stored value byte-identical. Re-parsing
      // the display form would re-stamp the offset with THIS viewer's zone,
      // silently shifting the instant of a value someone else wrote.
      if (storageVal === undefined && initialCharacter === undefined && current === initialDraft) {
        doneRef.current = true
        onSave(
          column.type === 'ttl'
            ? (value ?? null)
            : storedValue
              ? cleanCellValue(storedValue, column, timeZone)
              : null,
          reason
        )
        return
      }
      const raw = dateEditorRawValue(current, column, timeZone, storageVal)
      const cleaned = raw ? cleanCellValue(raw, column, timeZone) : null
      const parseError = columnTypeOf(column).parseErrorMessage
      if (raw && cleaned === null && parseError) {
        if (reason === 'blur') {
          if (!invalid) toast.error(parseError)
          doneRef.current = true
          onCancel()
        } else {
          toast.error(parseError)
          setInvalid(true)
          inputRef.current?.focus()
        }
        return
      }
      doneRef.current = true
      onSave(cleaned, reason)
    },
    [
      invalid,
      onSave,
      onCancel,
      timeZone,
      initialDraft,
      initialCharacter,
      storedValue,
      column,
      value,
    ]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        doSave('enter')
      } else if (e.key === 'Tab') {
        e.preventDefault()
        doSave(e.shiftKey ? 'shift-tab' : 'tab')
      } else if (e.key === 'Escape') {
        e.preventDefault()
        doneRef.current = true
        clearTimeout(blurTimeoutRef.current)
        onCancel()
      }
    },
    [doSave, onCancel]
  )

  const handlePopoverPointerDown = useCallback(() => {
    popoverPointerAtRef.current = Date.now()
  }, [])

  /** Saves on blur unless focus (or an in-flight pointer interaction) is still
   *  inside the editor's input/popover system. */
  const scheduleBlurSave = useCallback(() => {
    clearTimeout(blurTimeoutRef.current)
    blurTimeoutRef.current = setTimeout(() => {
      const active = document.activeElement
      if (active && (active === inputRef.current || popoverRef.current?.contains(active))) return
      if (Date.now() - popoverPointerAtRef.current < 300) {
        inputRef.current?.focus()
        return
      }
      doSave('blur')
    }, 200)
  }, [doSave])

  /**
   * The calendar (with `showTime`) owns the day/time merge and emits either a
   * bare `YYYY-MM-DD` (no time — the pick fully determines the value, commit
   * immediately) or a local `YYYY-MM-DDTHH:mm[:ss]` wall time (update the
   * draft and keep editing).
   */
  const handlePickerChange = useCallback(
    (picked: string) => {
      clearTimeout(blurTimeoutRef.current)
      if (isCalendarDateString(picked)) {
        doSave('enter', picked)
        return
      }
      const canonical = displayToStorage(picked, timeZone)
      if (!canonical) return
      setDraft(storageToDisplay(canonical, { seconds: true }))
      setInvalid(false)
      inputRef.current?.focus()
    },
    [doSave, timeZone]
  )

  const handlePickerOpenChange = useCallback((open: boolean) => {
    if (!open && !doneRef.current) {
      clearTimeout(blurTimeoutRef.current)
      inputRef.current?.focus()
    }
  }, [])

  return (
    <>
      <input
        ref={inputRef}
        type='text'
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          setInvalid(false)
        }}
        onKeyDown={handleKeyDown}
        onBlur={scheduleBlurSave}
        placeholder='mm/dd/yyyy'
        className={cn(
          'w-full min-w-0 select-text border-none bg-transparent p-0 text-[var(--text-primary)] text-small outline-hidden',
          invalid && 'text-[var(--text-error)]'
        )}
      />
      <Popover open onOpenChange={handlePickerOpenChange}>
        <PopoverAnchor className='absolute top-full left-0 size-0' />
        <PopoverContent
          ref={popoverRef}
          align='start'
          sideOffset={4}
          className='w-auto p-0'
          onPointerDownCapture={handlePopoverPointerDown}
          onBlurCapture={scheduleBlurSave}
        >
          <Calendar
            value={pickerValue}
            onChange={handlePickerChange}
            showTime
            today={todayLocalCalendarDate(timeZone)}
          />
        </PopoverContent>
      </Popover>
    </>
  )
}

/** Inline editor for `string`/`number`/`currency`/`json` columns — single-line text input. Numeric columns get a decimal keypad and reject a draft that cannot be parsed. */
function InlineTextEditor({
  value,
  column,
  initialCharacter,
  onSave,
  onCancel,
}: InlineEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(() =>
    initialCharacter !== undefined ? initialCharacter : formatValueForInput(value, column.type)
  )
  const [invalid, setInvalid] = useState(false)
  const doneRef = useRef(false)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return

    input.focus()
    if (initialCharacter !== undefined) {
      const len = input.value.length
      input.setSelectionRange(len, len)
    } else {
      input.select()
    }
  }, [])

  const rejectDraft = (message: string, reason: SaveReason) => {
    if (reason === 'blur') {
      if (!invalid) toast.error(message)
      doneRef.current = true
      onCancel()
    } else {
      toast.error(message)
      setInvalid(true)
      inputRef.current?.focus()
    }
  }

  const doSave = (reason: SaveReason) => {
    if (doneRef.current) return
    let cleaned: unknown
    try {
      cleaned = cleanCellValue(draft, column)
    } catch {
      rejectDraft('Invalid JSON', reason)
      return
    }
    // `cleanCellValue` nulls an unparseable draft rather than throwing; types
    // that declare a message reject it instead of silently clearing the cell.
    const parseError = columnTypeOf(column).parseErrorMessage
    if (cleaned === null && draft.trim() !== '' && parseError) {
      rejectDraft(parseError, reason)
      return
    }
    doneRef.current = true
    onSave(cleaned, reason)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      doSave('enter')
    } else if (e.key === 'Tab') {
      e.preventDefault()
      doSave(e.shiftKey ? 'shift-tab' : 'tab')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      doneRef.current = true
      onCancel()
    }
  }

  const inputMode = columnTypeOf(column).inputMode

  return (
    <input
      ref={inputRef}
      type='text'
      inputMode={inputMode}
      value={draft ?? ''}
      onChange={(e) => {
        setDraft(e.target.value)
        setInvalid(false)
      }}
      onKeyDown={handleKeyDown}
      onWheel={handleEditorWheel}
      onBlur={() => doSave('blur')}
      className={cn(
        'w-full min-w-0 select-text border-none bg-transparent p-0 text-[var(--text-primary)] text-small outline-hidden',
        invalid && 'text-[var(--text-error)]'
      )}
    />
  )
}

/**
 * Inline editor for `select`/`multiselect` columns. Renders the canonical
 * `DropdownMenu` anchored to the cell (an invisible full-cell trigger, no pill
 * chrome) and opens it immediately. Single-select commits on pick; multiselect
 * toggles and commits when the menu closes. Escape discards the draft, matching
 * the text/date inline editors.
 */
function InlineSelectEditor({ value, column, onSave, onCancel }: InlineEditorProps) {
  const isMulti = !!column.multiple
  const allOptions = column.options ?? []
  const [draft, setDraft] = useState<string[]>(() => selectedOptionIds(column, value))
  const [open, setOpen] = useState(true)
  const latestRef = useRef(draft)
  const doneRef = useRef(false)
  const cancelledRef = useRef(false)

  const setDraftAnd = (next: string[]) => {
    latestRef.current = next
    setDraft(next)
  }

  const commit = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    if (cancelledRef.current) {
      onCancel()
      return
    }
    const ids = latestRef.current
    onSave(isMulti ? ids : (ids[0] ?? null), 'enter')
  }, [isMulti, onSave, onCancel])

  // Escape closes the Radix menu (firing `onOpenChange(false)`); capture it
  // first so the close handler discards instead of committing.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelledRef.current = true
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) commit()
  }

  const handleSelectOption = (event: Event, id: string) => {
    if (!isMulti) {
      // Picking closes the menu → `handleOpenChange` commits the new value.
      setDraftAnd([id])
      return
    }
    // Keep the menu open across toggles; commit the set on close.
    event.preventDefault()
    const has = latestRef.current.includes(id)
    const next = has ? latestRef.current.filter((v) => v !== id) : [...latestRef.current, id]
    // A required multiselect can't be emptied — ignore removing the last option.
    if (column.required && next.length === 0) return
    setDraftAnd(next)
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          aria-label={`Edit ${column.name}`}
          className='absolute inset-0 cursor-pointer opacity-0'
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' sideOffset={2} className='min-w-[180px]'>
        {!isMulti && !column.required && (
          <DropdownMenuItem onSelect={() => setDraftAnd([])}>
            <span className='text-[var(--text-muted)]'>None</span>
            {draft.length === 0 && <Check className='ml-auto!' />}
          </DropdownMenuItem>
        )}
        {allOptions.map((option) => (
          <DropdownMenuItem key={option.id} onSelect={(e) => handleSelectOption(e, option.id)}>
            <SelectPill option={option} />
            {draft.includes(option.id) && <Check className='ml-auto!' />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Dispatches to the editor variant the column type declares. */
export function InlineEditor(props: InlineEditorProps) {
  switch (columnTypeOf(props.column).editor) {
    case 'date':
      return <InlineDateEditor {...props} />
    case 'select':
      return <InlineSelectEditor {...props} />
    // `toggle` types never open an editor — the grid flips them in place — so
    // reaching here at all means a text draft is the sane fallback.
    default:
      return <InlineTextEditor {...props} />
  }
}
