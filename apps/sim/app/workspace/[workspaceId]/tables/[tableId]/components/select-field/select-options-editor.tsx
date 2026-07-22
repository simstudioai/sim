'use client'

import { Badge, Button, ChipInput, cn } from '@sim/emcn'
import { Plus, Trash } from '@sim/emcn/icons'
import { generateShortId } from '@sim/utils/id'
import type { SelectColor, SelectOption } from '@/lib/table'
import { SELECT_COLOR_LABELS, SELECT_COLOR_ORDER } from './select-colors'

interface SelectOptionsEditorProps {
  options: SelectOption[]
  onChange: (options: SelectOption[]) => void
}

/** Default color for a freshly added option — cycles through the palette. */
function nextColor(count: number): SelectColor {
  return SELECT_COLOR_ORDER[count % SELECT_COLOR_ORDER.length]
}

interface ColorSwatchesProps {
  value: SelectColor
  onChange: (color: SelectColor) => void
}

/** Inline row of color squircles; the active color is ringed. */
function ColorSwatches({ value, onChange }: ColorSwatchesProps) {
  return (
    <div className='flex flex-wrap items-center gap-1.5'>
      {SELECT_COLOR_ORDER.map((color) => (
        <button
          key={color}
          type='button'
          aria-label={SELECT_COLOR_LABELS[color]}
          aria-pressed={color === value}
          onClick={() => onChange(color)}
          className={cn(
            'rounded-[6px] transition-shadow',
            color === value &&
              'ring-2 ring-[var(--text-icon)] ring-offset-1 ring-offset-[var(--bg)]'
          )}
        >
          {/* Reuse the Badge palette as the swatch fill so colors stay single-sourced. */}
          <Badge variant={color} size='sm' className='size-5 rounded-[6px] p-0' />
        </button>
      ))}
    </div>
  )
}

/**
 * Add/remove/rename/recolor the options of a `select`/`multiselect` column.
 * Option ids are stable across edits so existing cell data survives renames.
 */
export function SelectOptionsEditor({ options, onChange }: SelectOptionsEditorProps) {
  const update = (id: string, patch: Partial<SelectOption>) => {
    onChange(options.map((o) => (o.id === id ? { ...o, ...patch } : o)))
  }

  const remove = (id: string) => {
    onChange(options.filter((o) => o.id !== id))
  }

  const add = () => {
    onChange([...options, { id: generateShortId(), name: '', color: nextColor(options.length) }])
  }

  return (
    <div className='flex flex-col gap-3'>
      {options.map((option) => (
        <div key={option.id} className='flex flex-col gap-1.5'>
          <div className='flex items-center gap-1.5'>
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
              <Trash className='size-[14px]' />
            </Button>
          </div>
          <ColorSwatches value={option.color} onChange={(color) => update(option.id, { color })} />
        </div>
      ))}
      <Button variant='default' size='sm' onClick={add} className='self-start'>
        <Plus className='size-[14px]' />
        Add option
      </Button>
    </div>
  )
}
