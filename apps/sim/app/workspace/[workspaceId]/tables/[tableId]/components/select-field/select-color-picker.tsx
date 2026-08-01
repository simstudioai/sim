'use client'

import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@sim/emcn'
// Deep import, not the `@/lib/table` barrel — see select-options-editor.tsx.
import { SELECT_OPTION_COLORS, type SelectOptionColor } from '@/lib/table/types'

interface SelectColorPickerProps {
  color: SelectOptionColor | undefined
  onChange: (color: SelectOptionColor) => void
  /** Option name, so the trigger's accessible label says which option it colors. */
  optionName: string
}

/** Sentence-cased for display; the stored value stays the lowercase token. */
function labelFor(color: SelectOptionColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1)
}

/**
 * Colour picker for one option's pill.
 *
 * A named list rather than a bare swatch grid, for two reasons. Colour is then
 * not the only signal — the name is readable when the swatches are not
 * distinguishable to the viewer — and it lets the menu use the real
 * `DropdownMenuRadioItem` primitive: mutually exclusive `menuitemradio`
 * semantics, roving focus and typeahead, a visible selected indicator, and
 * close-on-select. Raw `<button>`s inside a `role="menu"` get none of that, and
 * notably leave the menu open after a pick.
 *
 * Each swatch is a real `Badge` in the variant it selects, so the menu shows
 * the exact chrome the pill will have in both themes — the badge stays the one
 * owner of its colours.
 */
export function SelectColorPicker({ color, onChange, optionName }: SelectColorPickerProps) {
  const current = color ?? 'gray'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className='flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover-hover:bg-[var(--surface-5)]'
        aria-label={`Color for ${optionName || 'option'}: ${labelFor(current)}`}
      >
        <Badge variant={current} size='swatch' />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='min-w-[160px]'>
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(next) => onChange(next as SelectOptionColor)}
        >
          {SELECT_OPTION_COLORS.map((swatch) => (
            <DropdownMenuRadioItem key={swatch} value={swatch}>
              <span className='flex items-center gap-2'>
                <Badge variant={swatch} size='swatch' />
                {labelFor(swatch)}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
