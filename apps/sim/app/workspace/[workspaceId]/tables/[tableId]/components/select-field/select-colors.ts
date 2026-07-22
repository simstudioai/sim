import type { SelectColor } from '@/lib/table'
import { SELECT_COLORS } from '@/lib/table/constants'

/** Human-readable labels for the option color palette (used for swatch a11y labels). */
export const SELECT_COLOR_LABELS: Record<SelectColor, string> = {
  gray: 'Gray',
  blue: 'Blue',
  green: 'Green',
  amber: 'Amber',
  orange: 'Orange',
  red: 'Red',
  purple: 'Purple',
  pink: 'Pink',
  teal: 'Teal',
  cyan: 'Cyan',
}

/** Palette tokens in display order. */
export const SELECT_COLOR_ORDER: readonly SelectColor[] = SELECT_COLORS
