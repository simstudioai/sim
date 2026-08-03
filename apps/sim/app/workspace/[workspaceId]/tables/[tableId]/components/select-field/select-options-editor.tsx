'use client'

import { useEffect, useRef, useState } from 'react'
import { Button, ChipInput } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import { generateShortId } from '@sim/utils/id'
// Deep import, not the `@/lib/table` barrel: this is a VALUE, and a runtime
// edge from a client component into that barrel reaches the executor and drags
// the executable tool registry (~4,700 modules) into three route bundles. The
// barrel is safe for `import type` only.
import type { SelectOption } from '@/lib/table'
import { SELECT_OPTION_COLORS } from '@/lib/table/types'
import { SelectColorPicker } from './select-color-picker'

interface SelectOptionsEditorProps {
  options: SelectOption[]
  onChange: (options: SelectOption[]) => void
}

/**
 * Add/remove/rename the options of a `select` column. Option ids are stable
 * across edits so existing cell data survives renames. New options are added by
 * typing into the trailing empty row — the first keystroke materializes the
 * option and focus jumps into it so typing flows straight through.
 */
export function SelectOptionsEditor({ options, onChange }: SelectOptionsEditorProps) {
  // Lazy-init: `useRef(new Map())` allocates a Map on every render and throws
  // all but the first away.
  const inputRefs = useRef<Map<string, HTMLInputElement> | null>(null)
  inputRefs.current ??= new Map()
  const trailingRef = useRef<HTMLInputElement>(null)
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null)

  // The new row and `pendingFocusId` land in the same commit, so the ref is
  // registered by the time this effect runs.
  useEffect(() => {
    if (!pendingFocusId) return
    const el = inputRefs.current?.get(pendingFocusId)
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
    inputRefs.current?.delete(id)
    onChange(options.filter((o) => o.id !== id))
  }

  /**
   * Typing into the trailing row promotes it to a real option and keeps focus.
   *
   * The color cycles through the palette by position rather than defaulting to
   * gray, so a freshly authored option set is distinguishable at a glance
   * without the user colouring each one by hand.
   */
  const materialize = (name: string) => {
    const id = generateShortId()
    const color = SELECT_OPTION_COLORS[options.length % SELECT_OPTION_COLORS.length]
    onChange([...options, { id, name, color }])
    setPendingFocusId(id)
  }

  return (
    <div className='flex flex-col gap-1'>
      {options.map((option) => (
        <div key={option.id} className='flex items-center gap-1.5'>
          <SelectColorPicker
            color={option.color}
            onChange={(color) => update(option.id, { color })}
            optionName={option.name}
          />
          <ChipInput
            ref={(el) => {
              if (el) inputRefs.current?.set(option.id, el)
              else inputRefs.current?.delete(option.id)
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
        <span className='size-7 shrink-0' aria-hidden />
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
