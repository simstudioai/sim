'use client'

import { Badge, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@sim/emcn'
import { SELECT_OPTION_COLORS, type SelectOptionColor } from '@/lib/table'

interface SelectColorPickerProps {
  color: SelectOptionColor | undefined
  onChange: (color: SelectOptionColor) => void
  /** Option name, so the trigger's accessible label says which option it colors. */
  optionName: string
}

/**
 * Swatch dropdown for one option's pill color.
 *
 * Each swatch is a real `Badge` in the variant it selects, so the menu shows the
 * exact chrome the pill will have in both themes rather than an approximation
 * of it — the badge stays the single owner of its colors.
 */
export function SelectColorPicker({ color, onChange, optionName }: SelectColorPickerProps) {
  const current = color ?? 'gray'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className='size-7 shrink-0 rounded-md p-1'
        aria-label={`Color for ${optionName || 'option'}`}
      >
        <Badge variant={current} size='sm' className='size-full justify-center p-0'>
          <span className='sr-only'>{current}</span>
        </Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='grid grid-cols-5 gap-1 p-1.5'>
        {SELECT_OPTION_COLORS.map((swatch) => (
          <button
            key={swatch}
            type='button'
            onClick={() => onChange(swatch)}
            aria-label={swatch}
            aria-pressed={swatch === current}
            className='rounded-md p-0.5 transition-colors hover-hover:bg-[var(--surface-5)]'
          >
            <Badge variant={swatch} size='sm' className='size-5 justify-center p-0' />
          </button>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
