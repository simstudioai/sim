'use client'

import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type WheelEvent,
} from 'react'
import { Input } from '@sim/emcn/field/inputs'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { usePopoverContainer } from '@sim/emcn/menu/use-popover-container'
import { Calendar } from '@sim/emcn/picker/calendar'
import { createPortal } from 'react-dom'
import { toast } from '@/lib/toast/sink'
import { selectedOptionIds } from '@/app/(product)/workspace/[workspaceId]/tables/[tableId]/_components/select-field/select-field'
import styles from '@/app/(product)/workspace/[workspaceId]/tables/[tableId]/_components/table-grid/table-grid.module.css'
import {
  type ColumnDefinition,
  cleanCellValue,
  columnTypeOf,
  dateValueToLocalParts,
  displayToStorage,
  formatValueForInput,
  getTimezoneEditBlockedMessage,
  isCalendarDateString,
  type SaveReason,
  storageToDisplay,
  ttlValueFromPicker,
  ttlValueToPickerParts,
  useTimezoneState,
} from '@/platform/lib/data/tables'

interface InlineEditorProps {
  value: unknown
  column: ColumnDefinition
  initialCharacter?: string
  /** Shows the value without allowing changes; text stays selectable and copyable. */
  readOnly?: boolean
  onSave: (value: unknown, reason: SaveReason) => void
  onCancel: () => void
}

/** How long a blur waits for focus to settle in the editor's popover before it saves. */
const BLUR_SETTLE_MS = 200
/** A pointer press in the popover this recent means the blur came from it, not from leaving. */
const POPOVER_PRESS_WINDOW_MS = 300

/**
 * The raw draft the column type coerces on save. Ordinary date columns keep their display parser
 * for partial dates; other date-editor types receive the untouched draft.
 */
function dateEditorRawValue(
  draft: string,
  column: ColumnDefinition,
  timeZone: string,
  storageValue?: string
): string {
  if (storageValue !== undefined) return storageValue
  return column.type === 'date' ? (displayToStorage(draft, timeZone) ?? draft) : draft
}

/** Wheel gestures over an inline editor scroll the table instead of the input. */
function handleEditorWheel(e: WheelEvent<HTMLInputElement>) {
  e.preventDefault()
  const container = e.currentTarget.closest<HTMLElement>('[data-table-scroll]')
  container?.scrollBy(e.deltaX, e.deltaY)
}

/**
 * The editor for `date` columns, which waits for the viewer's timezone: a date typed before it is
 * known would be stored against the wrong offset.
 */
function InlineDateEditor(props: InlineEditorProps) {
  const { onCancel } = props
  const timezoneState = useTimezoneState()
  const timezoneBlockedMessage = getTimezoneEditBlockedMessage(timezoneState)

  useEffect(() => {
    if (timezoneState.status !== 'error' && timezoneState.status !== 'invalid') return
    if (timezoneBlockedMessage) toast.error(timezoneBlockedMessage)
    onCancel()
  }, [onCancel, timezoneBlockedMessage, timezoneState.status])

  if (timezoneState.status !== 'ready') return null
  return (
    <ReadyInlineDateEditor
      value={props.value}
      column={props.column}
      initialCharacter={props.initialCharacter}
      readOnly={props.readOnly}
      onSave={props.onSave}
      onCancel={onCancel}
      initialTimeZone={timezoneState.timezone}
    />
  )
}

interface ReadyInlineDateEditorProps extends InlineEditorProps {
  initialTimeZone: string
}

/**
 * Text input plus a calendar and time field below the cell. Picking a day on a date-only value
 * commits at once; when the value carries a time, picker edits update the draft (the day pick keeps
 * the time, the time field keeps the day) and Enter or blur commits.
 */
function ReadyInlineDateEditor({
  value,
  column,
  initialCharacter,
  readOnly,
  onSave,
  onCancel,
  initialTimeZone,
}: ReadyInlineDateEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef(false)
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const popoverPointerAtRef = useRef(0)
  /** One wall-clock interpretation for the lifetime of this edit. */
  const editTimeZoneRef = useRef(initialTimeZone)
  const timeZone = editTimeZoneRef.current

  const isOffsetDate = columnTypeOf(column).editor === 'offset-date'
  const storedValue = formatValueForInput(value, column.type)
  const initialDraft =
    initialCharacter !== undefined
      ? initialCharacter
      : isOffsetDate
        ? storedValue
        : storageToDisplay(storedValue, { seconds: true })
  const [draft, setDraft] = useState(initialDraft)
  const [invalid, setInvalid] = useState(false)
  /** Picker commits change the draft from timers and child handlers, so blur-save reads it here. */
  const draftRef = useRef(draft)
  draftRef.current = draft

  const offsetParts = isOffsetDate ? ttlValueToPickerParts(draft) : null
  const draftParts =
    offsetParts ?? dateValueToLocalParts(displayToStorage(draft, timeZone) ?? storedValue)

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
      // An untouched Date cell keeps its stored offset instead of being reread in this zone.
      if (storageVal === undefined && initialCharacter === undefined && current === initialDraft) {
        doneRef.current = true
        onSave(storedValue ? cleanCellValue(storedValue, column, timeZone) : null, reason)
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
    [invalid, onSave, onCancel, timeZone, initialDraft, initialCharacter, storedValue, column]
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
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

  /** Saves on blur unless focus, or a pointer press in flight, is still inside the editor. */
  const scheduleBlurSave = useCallback(() => {
    clearTimeout(blurTimeoutRef.current)
    blurTimeoutRef.current = setTimeout(() => {
      const active = document.activeElement
      if (active && (active === inputRef.current || popoverRef.current?.contains(active))) return
      if (Date.now() - popoverPointerAtRef.current < POPOVER_PRESS_WINDOW_MS) {
        inputRef.current?.focus()
        return
      }
      doSave('blur')
    }, BLUR_SETTLE_MS)
  }, [doSave])

  /** A day with no time fully determines the value, so it commits; a timed value keeps editing. */
  const commitPick = (picked: string) => {
    clearTimeout(blurTimeoutRef.current)
    if (isCalendarDateString(picked)) {
      doSave('enter', offsetParts ? ttlValueFromPicker(picked, null, offsetParts.offset) : picked)
      return
    }
    if (offsetParts) {
      const [day, time] = picked.split('T')
      setDraft(ttlValueFromPicker(day, time ?? null, offsetParts.offset))
      setInvalid(false)
      inputRef.current?.focus()
      return
    }
    const canonical = displayToStorage(picked, timeZone)
    if (!canonical) return
    setDraft(storageToDisplay(canonical, { seconds: true }))
    setInvalid(false)
    inputRef.current?.focus()
  }

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
        readOnly={readOnly}
        placeholder={isOffsetDate ? 'YYYY-MM-DDTHH:mm:ss±HH:mm' : 'mm/dd/yyyy'}
        className={styles.cellInput}
        data-type='T060'
        data-invalid={invalid || undefined}
      />
      {!readOnly && (
        <CellPopover
          anchor={inputRef}
          popoverRef={popoverRef}
          label={`Choose ${column.name}`}
          onPointerDownCapture={() => {
            popoverPointerAtRef.current = Date.now()
          }}
          onBlurCapture={scheduleBlurSave}
        >
          <CalendarWithTime
            label={column.name}
            day={draftParts.day}
            time={draftParts.time}
            timeLabel={offsetParts ? `Time (${offsetParts.offset})` : 'Time'}
            onPick={commitPick}
          />
        </CellPopover>
      )}
    </>
  )
}

interface CalendarWithTimeProps {
  label: string
  day: string | null
  time: string | null
  timeLabel: string
  /** A bare `YYYY-MM-DD` for a day pick on a date-only value, else a `YYYY-MM-DDTHH:mm:ss` wall time. */
  onPick: (value: string) => void
}

/** The calendar and a time field: a day pick keeps the time of day, a time edit keeps the day. */
function CalendarWithTime({ label, day, time, timeLabel, onPick }: CalendarWithTimeProps) {
  const focusTarget = useRef<HTMLButtonElement>(null)
  return (
    <div className={styles.datePanel}>
      <Calendar
        key={day ?? 'none'}
        label={label}
        start={day ?? undefined}
        focusTarget={focusTarget}
        onSelect={(picked) => onPick(time ? `${picked}T${time}` : picked)}
      />
      <Input
        label={timeLabel}
        type='time'
        placeholder='HH:MM:SS'
        value={time ?? ''}
        onChange={(next) => {
          if (!next) return
          const seconds = next.length === 5 ? `${next}:00` : next
          onPick(`${day ?? todayIso()}T${seconds}`)
        }}
      />
    </div>
  )
}

function todayIso() {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

interface CellPopoverProps {
  anchor: RefObject<HTMLElement | null>
  popoverRef: RefObject<HTMLDivElement | null>
  label: string
  onPointerDownCapture: () => void
  onBlurCapture: () => void
  children: ReactNode
}

/**
 * A floating panel under an inline editor that leaves focus in the editor's input: the input stays
 * the thing being typed into, and the panel only offers picks. It follows the cell as the table
 * scrolls and renders in the active theme's layer.
 */
function CellPopover({
  anchor,
  popoverRef,
  label,
  onPointerDownCapture,
  onBlurCapture,
  children,
}: CellPopoverProps) {
  const portal = usePopoverContainer()
  // The anchor input mounts in the same commit, so its ref is only readable once that commit lands.
  useEffect(() => {
    portal.trigger(anchor.current)
  }, [anchor, portal.trigger])

  useLayoutEffect(() => {
    const panel = popoverRef.current
    const target = anchor.current
    if (!panel || !target) return
    const place = () => {
      const rect = target.getBoundingClientRect()
      const cell = target.closest('td') ?? target
      const cellRect = cell.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()
      const below = cellRect.bottom + 4
      const top =
        below + panelRect.height > window.innerHeight - 8
          ? Math.max(8, cellRect.top - panelRect.height - 4)
          : below
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - panelRect.width - 8)
      panel.style.setProperty('top', `${top}px`)
      panel.style.setProperty('left', `${left}px`)
    }
    place()
    const scroller = target.closest('[data-table-scroll]')
    scroller?.addEventListener('scroll', place, { passive: true })
    window.addEventListener('resize', place)
    return () => {
      scroller?.removeEventListener('scroll', place)
      window.removeEventListener('resize', place)
    }
  })

  if (!portal.container) return null
  return createPortal(
    <div
      ref={popoverRef}
      role='dialog'
      aria-label={label}
      className={styles.cellPopover}
      data-material='floating'
      data-elevation='menu'
      onPointerDownCapture={onPointerDownCapture}
      onBlurCapture={onBlurCapture}
    >
      {children}
    </div>,
    portal.container
  )
}

/**
 * The editor for `string`, `number`, `currency` and `json` columns. Numeric columns get a decimal
 * keypad and reject a draft that cannot be parsed.
 */
function InlineTextEditor({
  value,
  column,
  initialCharacter,
  readOnly,
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
    // An unparseable draft cleans to null; a type that declares a message rejects it instead of
    // silently clearing the cell.
    const parseError = columnTypeOf(column).parseErrorMessage
    if (cleaned === null && draft.trim() !== '' && parseError) {
      rejectDraft(parseError, reason)
      return
    }
    doneRef.current = true
    onSave(cleaned, reason)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
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

  return (
    <input
      ref={inputRef}
      type='text'
      inputMode={columnTypeOf(column).inputMode}
      value={draft ?? ''}
      onChange={(e) => {
        setDraft(e.target.value)
        setInvalid(false)
      }}
      onKeyDown={handleKeyDown}
      onWheel={handleEditorWheel}
      onBlur={() => doSave('blur')}
      readOnly={readOnly}
      className={styles.cellInput}
      data-type='T060'
      data-invalid={invalid || undefined}
    />
  )
}

/**
 * The editor for `select` columns: the option menu, opened at once below the cell. A single select
 * commits on pick; a multiselect toggles and commits when the menu closes. Escape discards.
 */
function InlineSelectEditor({ value, column, readOnly, onSave, onCancel }: InlineEditorProps) {
  const isMulti = !!column.multiple
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

  // Escape closes the menu; mark it first so the close discards instead of committing.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') cancelledRef.current = true
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const close = () => {
    setOpen(false)
    commit()
  }

  const pick = (id: string) => {
    if (!isMulti) {
      setDraftAnd([id])
      close()
      return
    }
    const has = latestRef.current.includes(id)
    const next = has ? latestRef.current.filter((v) => v !== id) : [...latestRef.current, id]
    // A required multiselect can't be emptied: ignore removing its last option.
    if (column.required && next.length === 0) return
    setDraftAnd(next)
  }

  const actions: MenuAction[] = [
    ...(!isMulti && !column.required
      ? [
          {
            id: 'none',
            label: 'None',
            checked: draft.length === 0,
            disabled: readOnly,
            onSelect: () => {
              setDraftAnd([])
              close()
            },
          },
        ]
      : []),
    ...(column.options ?? []).map((option) => ({
      id: option.id,
      label: option.name,
      checked: draft.includes(option.id),
      disabled: readOnly,
      onSelect: () => pick(option.id),
    })),
  ]

  return (
    <span className={styles.selectAnchor}>
      <ActionMenu
        label={`Edit ${column.name}`}
        icon='I051'
        tooltip={false}
        open={open}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        actions={actions}
      />
    </span>
  )
}

/** Dispatches to the editor the column type declares. */
export function InlineEditor({
  value,
  column,
  initialCharacter,
  readOnly,
  onSave,
  onCancel,
}: InlineEditorProps) {
  switch (columnTypeOf(column).editor) {
    case 'date':
      return (
        <InlineDateEditor
          value={value}
          column={column}
          initialCharacter={initialCharacter}
          readOnly={readOnly}
          onSave={onSave}
          onCancel={onCancel}
        />
      )
    case 'offset-date':
      return (
        <ReadyInlineDateEditor
          value={value}
          column={column}
          initialCharacter={initialCharacter}
          readOnly={readOnly}
          onSave={onSave}
          onCancel={onCancel}
          initialTimeZone='UTC'
        />
      )
    case 'select':
      return (
        <InlineSelectEditor
          value={value}
          column={column}
          readOnly={readOnly}
          onSave={onSave}
          onCancel={onCancel}
        />
      )
    // Toggle types never open an editor (the grid flips them in place), so a text draft is the
    // sane fallback.
    default:
      return (
        <InlineTextEditor
          value={value}
          column={column}
          initialCharacter={initialCharacter}
          readOnly={readOnly}
          onSave={onSave}
          onCancel={onCancel}
        />
      )
  }
}
