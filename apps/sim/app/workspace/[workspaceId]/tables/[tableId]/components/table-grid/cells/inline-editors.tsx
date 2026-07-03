'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Calendar, cn, Popover, PopoverAnchor, PopoverContent, toast } from '@sim/emcn'
import type { ColumnDefinition } from '@/lib/table'
import type { SaveReason } from '../../../types'
import {
  cleanCellValue,
  displayToStorage,
  formatValueForInput,
  storageToDisplay,
} from '../../../utils'

interface InlineEditorProps {
  value: unknown
  column: ColumnDefinition
  initialCharacter?: string
  onSave: (value: unknown, reason: SaveReason) => void
  onCancel: () => void
}

/** Inline editor for `date` columns — text input + popover calendar. */
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
  const [invalid, setInvalid] = useState(false)

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
      clearTimeout(blurTimeoutRef.current)
      const raw = storageVal ?? displayToStorage(draft) ?? draft
      if (raw && Number.isNaN(Date.parse(raw))) {
        toast.error('Invalid date')
        if (reason === 'blur') {
          doneRef.current = true
          onCancel()
        } else {
          setInvalid(true)
          inputRef.current?.focus()
        }
        return
      }
      doneRef.current = true
      onSave(raw || null, reason)
    },
    [draft, onSave, onCancel]
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
        onChange={(e) => {
          setDraft(e.target.value)
          setInvalid(false)
        }}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder='mm/dd/yyyy'
        className={cn(
          'w-full min-w-0 select-text border-none bg-transparent p-0 text-[var(--text-primary)] text-small outline-none',
          invalid && 'text-[var(--text-error)]'
        )}
      />
      <Popover open onOpenChange={handlePickerOpenChange}>
        <PopoverAnchor className='absolute top-full left-0 size-0' />
        <PopoverContent align='start' sideOffset={4} className='w-auto p-0'>
          <Calendar value={pickerValue} onChange={handlePickerChange} />
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

  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    e.preventDefault()
    const container = e.currentTarget.closest('[data-table-scroll]') as HTMLElement | null
    if (container) {
      container.scrollBy(e.deltaX, e.deltaY)
    }
  }

  const rejectDraft = (message: string, reason: SaveReason) => {
    toast.error(message)
    if (reason === 'blur') {
      doneRef.current = true
      onCancel()
    } else {
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
      onWheel={handleWheel}
      onBlur={() => doSave('blur')}
      className={cn(
        'w-full min-w-0 select-text border-none bg-transparent p-0 text-[var(--text-primary)] text-small outline-none',
        invalid && 'text-[var(--text-error)]'
      )}
    />
  )
}

/** Dispatches to the right editor variant based on the column type. */
export function InlineEditor(props: InlineEditorProps) {
  if (props.column.type === 'date') {
    return <InlineDateEditor {...props} />
  }
  return <InlineTextEditor {...props} />
}
