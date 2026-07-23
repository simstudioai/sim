'use client'

import { Button, ChipInput } from '@sim/emcn'
import { Plus, X } from '@sim/emcn/icons'
import { generateShortId } from '@sim/utils/id'
import type { SelectOption } from '@/lib/table'

interface SelectOptionsEditorProps {
  options: SelectOption[]
  onChange: (options: SelectOption[]) => void
}

/**
 * Add/remove/rename the options of a `select`/`multiselect` column. Option ids
 * are stable across edits so existing cell data survives renames. Options
 * default to the neutral `gray` pill — per-option colors are not yet exposed
 * (the `color` field stays in the model so a picker can be re-added later).
 */
export function SelectOptionsEditor({ options, onChange }: SelectOptionsEditorProps) {
  const update = (id: string, patch: Partial<SelectOption>) => {
    onChange(options.map((o) => (o.id === id ? { ...o, ...patch } : o)))
  }

  const remove = (id: string) => {
    onChange(options.filter((o) => o.id !== id))
  }

  const add = () => {
    onChange([...options, { id: generateShortId(), name: '', color: 'gray' }])
  }

  return (
    <div className='flex flex-col gap-1'>
      {options.map((option) => (
        <div key={option.id} className='flex items-center gap-1.5'>
          <ChipInput
            value={option.name}
            onChange={(e) => update(option.id, { name: e.target.value })}
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
      <Button
        variant='ghost'
        onClick={add}
        className='mt-1 h-7 w-full justify-start gap-1.5 border border-[var(--border-1)] border-dashed text-[var(--text-muted)] text-small'
      >
        <Plus className='size-[14px]' />
        Add option
      </Button>
    </div>
  )
}
