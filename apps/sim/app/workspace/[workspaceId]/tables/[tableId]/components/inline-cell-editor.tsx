'use client'

import { useEffect, useRef, useState } from 'react'
import type { ColumnDefinition } from '@/lib/table'
import { cleanCellValue, formatValueForInput } from '../lib/utils'

interface InlineCellEditorProps {
  value: unknown
  column: ColumnDefinition
  onSave: (value: unknown) => void
  onCancel: () => void
}

export function InlineCellEditor({ value, column, onSave, onCancel }: InlineCellEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(() => formatValueForInput(value, column.type))
  const doneRef = useRef(false)

  useEffect(() => {
    const input = inputRef.current
    if (input) {
      input.focus()
      input.select()
    }
  }, [])

  const handleSave = () => {
    if (doneRef.current) return
    doneRef.current = true

    try {
      const cleaned = cleanCellValue(draft, column)
      onSave(cleaned)
    } catch {
      onCancel()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      doneRef.current = true
      onCancel()
    }
  }

  const inputType = column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'

  return (
    <input
      ref={inputRef}
      type={inputType}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleSave}
      className='h-full w-full rounded-[2px] border-none bg-transparent px-[4px] py-[2px] text-[13px] text-[var(--text-primary)] outline-none ring-1 ring-[var(--accent)] ring-inset'
    />
  )
}
