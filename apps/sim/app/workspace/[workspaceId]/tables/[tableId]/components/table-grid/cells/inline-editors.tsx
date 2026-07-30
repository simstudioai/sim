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
import { isCalendarDateString } from '@/lib/table/dates'
import { useTimezone } from '@/hooks/queries/general-settings'
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
function InlineDateEditor({
  value,
  column,
  initialCharacter,
  onSave,
  onCancel,
}: InlineEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef(false)
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** Timestamp of the last pointerdown inside the popover — blur-save skips
   *  and refocuses while a popover interaction is in flight (covers browsers
   *  where buttons don't take focus on click). */
  const popoverPointerAtRef = useRef(0)
  const timeZone = useTimezone()

  const storedValue = formatValueForInput(value, column.type)
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
        onSave(storedValue || null, reason)
        return
      }
      const raw = storageVal ?? displayToStorage(current, timeZone) ?? current
      if (raw && Number.isNaN(Date.parse(raw))) {
        if (reason === 'blur') {
          if (!invalid) toast.error('Invalid date')
          doneRef.current = true
          onCancel()
        } else {
          toast.error('Invalid date')
          setInvalid(true)
          inputRef.current?.focus()
        }
        return
      }
      doneRef.current = true
      onSave(raw || null, reason)
    },
    [invalid, onSave, onCancel, timeZone, initialDraft, initialCharacter, storedValue]
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
          'w-full min-w-0 select-text border-none bg-transparent p-0 text-[var(--text-primary)] text-small outline-none',
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

/** Inline editor for `string`/`number`/`json` columns — single-line text input. Number columns use `type="number"` so the browser rejects non-numeric input. */
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
    if (column.type === 'number' && cleaned === null && draft.trim() !== '') {
      rejectDraft('Invalid number', reason)
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

  const isNumber = column.type === 'number'

  return (
    <input
      ref={inputRef}
      type='text'
      inputMode={isNumber ? 'decimal' : undefined}
      value={draft ?? ''}
      onChange={(e) => {
        setDraft(e.target.value)
        setInvalid(false)
      }}
      onKeyDown={handleKeyDown}
      onWheel={handleEditorWheel}
      onBlur={() => doSave('blur')}
      className={cn(
        'w-full min-w-0 select-text border-none bg-transparent p-0 text-[var(--text-primary)] text-small outline-none',
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
            {draft.length === 0 && <Check className='!ml-auto' />}
          </DropdownMenuItem>
        )}
        {allOptions.map((option) => (
          <DropdownMenuItem key={option.id} onSelect={(e) => handleSelectOption(e, option.id)}>
            <SelectPill option={option} />
            {draft.includes(option.id) && <Check className='!ml-auto' />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Dispatches to the right editor variant based on the column type. */
export function InlineEditor(props: InlineEditorProps) {
  if (props.column.type === 'date') {
    return <InlineDateEditor {...props} />
  }
  if (props.column.type === 'select') {
    return <InlineSelectEditor {...props} />
  }
  return <InlineTextEditor {...props} />
}
