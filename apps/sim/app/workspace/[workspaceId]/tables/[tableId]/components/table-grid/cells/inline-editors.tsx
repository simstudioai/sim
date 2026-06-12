'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Badge,
  DatePicker,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { ColumnDefinition } from '@/lib/table'
import { getColumnStorageType } from '@/lib/table/constants'
import type { SaveReason } from '../../../types'
import {
  cleanCellValue,
  displayToStorage,
  formatValueForInput,
  selectBadgeVariant,
  storageToDisplay,
} from '../../../utils'

interface InlineEditorProps {
  value: unknown
  column: ColumnDefinition
  initialCharacter?: string
  onSave: (value: unknown, reason: SaveReason) => void
  onCancel: () => void
}

/** Inline editor for `date` columns — text input + popover DatePicker. */
function InlineDateEditor({
  value,
  column,
  initialCharacter,
  onSave,
  onCancel,
}: InlineEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef(false)
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const storedValue = formatValueForInput(value, column.type)
  const [draft, setDraft] = useState(() =>
    initialCharacter !== undefined ? initialCharacter : storageToDisplay(storedValue)
  )

  const pickerValue = displayToStorage(draft) || storedValue || undefined

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
      doneRef.current = true
      clearTimeout(blurTimeoutRef.current)
      const raw = storageVal ?? displayToStorage(draft) ?? draft
      const val = raw && !Number.isNaN(Date.parse(raw)) ? raw : null
      onSave(val, reason)
    },
    [draft, onSave]
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

  const handleBlur = useCallback(() => {
    blurTimeoutRef.current = setTimeout(() => doSave('blur'), 200)
  }, [doSave])

  const handlePickerChange = useCallback(
    (dateStr: string) => {
      clearTimeout(blurTimeoutRef.current)
      doSave('enter', dateStr)
    },
    [doSave]
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
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder='mm/dd/yyyy'
        className={cn(
          'w-full min-w-0 select-text border-none bg-transparent p-0 text-[var(--text-primary)] text-small outline-none'
        )}
      />
      <div className='absolute top-full left-0 size-0'>
        <DatePicker
          mode='single'
          value={pickerValue}
          onChange={handlePickerChange}
          open={true}
          onOpenChange={handlePickerOpenChange}
          showTrigger={false}
          size='sm'
        />
      </div>
    </>
  )
}

/**
 * Inline editor for `select` columns — filter input + floating option list.
 * Typing filters the column's predefined options; Enter or click picks the
 * highlighted option. A draft that matches no option saves as-is (option
 * membership is a soft constraint), and an empty draft clears the cell.
 */
function InlineSelectEditor({
  value,
  column,
  initialCharacter,
  onSave,
  onCancel,
}: InlineEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef(false)
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const [draft, setDraft] = useState(() =>
    initialCharacter !== undefined ? initialCharacter : formatValueForInput(value, column.type)
  )
  const [highlightIndex, setHighlightIndex] = useState(0)
  // Enter/Tab only auto-pick the highlighted option after the user has arrow-
  // navigated, or typed a non-empty filter; a bare Enter on an untouched draft
  // saves it verbatim, so confirming a cell never silently rewrites its value
  // to an option's casing. Typeahead-opened editors start typed.
  const [typed, setTyped] = useState(initialCharacter !== undefined)
  const [navigated, setNavigated] = useState(false)

  const options = column.options ?? []
  const query = draft.trim().toLowerCase()
  const filtered = query ? options.filter((o) => o.toLowerCase().includes(query)) : options
  const highlighted = filtered[Math.min(highlightIndex, filtered.length - 1)]

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
    (reason: SaveReason, picked?: string) => {
      if (doneRef.current) return
      doneRef.current = true
      clearTimeout(blurTimeoutRef.current)
      const raw = (picked ?? draft).trim()
      onSave(raw === '' ? null : raw, reason)
    },
    [draft, onSave]
  )

  // The option Enter/Tab/blur should apply: the highlighted one once the user
  // has arrow-navigated or typed a non-empty filter, else the raw draft.
  const resolvePick = useCallback(
    () =>
      highlighted !== undefined && (navigated || (typed && query !== '')) ? highlighted : undefined,
    [highlighted, navigated, typed, query]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (filtered.length === 0) return
        setNavigated(true)
        const delta = e.key === 'ArrowDown' ? 1 : -1
        setHighlightIndex((i) => (i + delta + filtered.length) % filtered.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const reason: SaveReason = e.key === 'Tab' ? (e.shiftKey ? 'shift-tab' : 'tab') : 'enter'
        doSave(reason, resolvePick())
      } else if (e.key === 'Escape') {
        e.preventDefault()
        doneRef.current = true
        clearTimeout(blurTimeoutRef.current)
        onCancel()
      }
    },
    [doSave, onCancel, filtered.length, resolvePick]
  )

  const handleBlur = useCallback(() => {
    blurTimeoutRef.current = setTimeout(() => doSave('blur', resolvePick()), 200)
  }, [doSave, resolvePick])

  return (
    <Popover open>
      <PopoverAnchor asChild>
        <input
          ref={inputRef}
          type='text'
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setHighlightIndex(0)
            setTyped(true)
            setNavigated(false)
          }}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className='w-full min-w-0 select-text border-none bg-transparent p-0 text-[var(--text-primary)] text-small outline-none'
        />
      </PopoverAnchor>
      {filtered.length > 0 && (
        <PopoverContent
          align='start'
          maxHeight={240}
          minWidth={160}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {filtered.map((option, i) => (
            <PopoverItem
              key={option}
              active={option === highlighted}
              onMouseEnter={() => setHighlightIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                doSave('enter', option)
              }}
            >
              <Badge variant={selectBadgeVariant(option)} size='sm' className='max-w-full'>
                <span className='truncate'>{option}</span>
              </Badge>
            </PopoverItem>
          ))}
        </PopoverContent>
      )}
    </Popover>
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

  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    e.preventDefault()
    const container = e.currentTarget.closest('[data-table-scroll]') as HTMLElement | null
    if (container) {
      container.scrollBy(e.deltaX, e.deltaY)
    }
  }

  const doSave = (reason: SaveReason) => {
    if (doneRef.current) return
    doneRef.current = true
    try {
      onSave(cleanCellValue(draft, column), reason)
    } catch {
      onCancel()
    }
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

  const isNumber = getColumnStorageType(column.type) === 'number'

  return (
    <input
      ref={inputRef}
      type='text'
      inputMode={isNumber ? 'decimal' : undefined}
      value={draft ?? ''}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
      onBlur={() => doSave('blur')}
      className='w-full min-w-0 select-text border-none bg-transparent p-0 text-[var(--text-primary)] text-small outline-none'
    />
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
