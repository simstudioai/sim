'use client'

import { useEffect, useRef, useState } from 'react'
import { Button, ChipInput } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import { generateShortId } from '@sim/utils/id'
import type { SelectOption } from '@/lib/table'

interface SelectOptionsEditorProps {
  options: SelectOption[]
  onChange: (options: SelectOption[]) => void
}

/**
 * Add/remove/rename the options of a `select` column. Option ids are stable
 * across edits so existing cell data survives renames. New options are added by
 * typing into the trailing empty row — the first keystroke materializes the
 * option and focus jumps into it so typing flows straight through. Options
 * default to the neutral `gray` pill (per-option colors aren't exposed yet; the
 * `color` field stays in the model so a picker can be re-added later).
 */
export function SelectOptionsEditor({ options, onChange }: SelectOptionsEditorProps) {
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map())
  const trailingRef = useRef<HTMLInputElement>(null)
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null)

  // Focus a freshly materialized option once it has rendered, cursor at end.
  // The new row and `pendingFocusId` land in the same commit, so its ref is
  // registered by the time this effect runs.
  useEffect(() => {
    if (!pendingFocusId) return
    const el = inputRefs.current.get(pendingFocusId)
    if (el) {
      el.focus()
      const end = el.value.length
      el.setSelectionRange(end, end)
    }
    setPendingFocusId(null)
  }, [pendingFocusId])

  const update = (id: string, patch: Partial<SelectOption>) => {
    onChange(options.map((o) => (o.id === id ? { ...o, ...patch } : o)))
  }

  const remove = (id: string) => {
    inputRefs.current.delete(id)
    onChange(options.filter((o) => o.id !== id))
  }

  /** Typing into the trailing row promotes it to a real option and keeps focus. */
  const materialize = (name: string) => {
    const id = generateShortId()
    onChange([...options, { id, name, color: 'gray' }])
    setPendingFocusId(id)
  }

  return (
    <div className='flex flex-col gap-1'>
      {options.map((option) => (
        <div key={option.id} className='flex items-center gap-1.5'>
          <ChipInput
            ref={(el) => {
              if (el) inputRefs.current.set(option.id, el)
              else inputRefs.current.delete(option.id)
            }}
            value={option.name}
            onChange={(e) => update(option.id, { name: e.target.value })}
            onKeyDown={(e) => {
              // Enter jumps to the trailing row so options can be added in a row.
              if (e.key === 'Enter') {
                e.preventDefault()
                trailingRef.current?.focus()
              }
            }}
            placeholder='Option name'
            spellCheck={false}
            autoComplete='off'
            className='min-w-0 flex-1'
          />
          <Button
            variant='ghost'
            size='sm'
            onClick={() => remove(option.id)}
            className='!p-1 size-7 shrink-0'
            aria-label={`Remove ${option.name || 'option'}`}
          >
            <X className='size-[12px]' />
          </Button>
        </div>
      ))}
      <div className='flex items-center gap-1.5'>
        <ChipInput
          ref={trailingRef}
          value=''
          onChange={(e) => {
            if (e.target.value) materialize(e.target.value)
          }}
          placeholder='Add option'
          spellCheck={false}
          autoComplete='off'
          className='min-w-0 flex-1'
        />
        <span className='size-7 shrink-0' aria-hidden />
      </div>
    </div>
  )
}
