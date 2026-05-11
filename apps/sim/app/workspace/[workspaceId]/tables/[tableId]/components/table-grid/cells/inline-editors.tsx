'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { DatePicker } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
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

  const isNumber = column.type === 'number'

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
  return <InlineTextEditor {...props} />
}
