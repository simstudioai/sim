'use client'

import { cn } from '../../lib/cn'
import { chipFilledFillTokens, chipHeightClass, chipRadiusClass } from '../chip/chip-chrome'
import { Combobox, type ComboboxProps } from '../combobox/combobox'

/**
 * Chip-styled {@link Combobox}. A thin wrapper that skins the trigger to match
 * the 30px chip pill (`rounded-lg`, chip surface tokens) shared by
 * `ChipSelect`, `ChipModal`, and `ChipInput`.
 *
 * Reuses 100% of `Combobox` — search, editable entry, multi-select, groups,
 * async loading, per-option icons, and `overlayContent` all work unchanged.
 * Only the trigger chrome is overridden (the `className` merges last in
 * `Combobox`, so `rounded-lg` / height / dark surface and the chip `--text-body`
 * color win over the combobox defaults). Weight is no longer overridden here —
 * `Combobox` inherits the document's 400, which is already the chip weight.
 * The muted placeholder still applies because the combobox tints the inner
 * label span with `--text-muted` independently of the trigger className.
 *
 * Use this in chip-styled surfaces (settings pages, chip forms). For the
 * menu-selection case, including searchable menus, prefer `ChipSelect`.
 *
 * @example
 * <ChipCombobox options={SOURCE_OPTIONS} value={source} onChange={setSource} />
 */
export function ChipCombobox({ className, ...props }: ComboboxProps) {
  return (
    <Combobox
      {...props}
      className={cn(
        chipRadiusClass,
        chipFilledFillTokens,
        chipHeightClass,
        'text-[var(--text-body)]',
        className
      )}
    />
  )
}
