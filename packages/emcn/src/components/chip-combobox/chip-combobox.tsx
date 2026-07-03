'use client'

import { cn } from '../../lib/cn'
import { Combobox, type ComboboxProps } from '../combobox/combobox'

/**
 * Chip-styled {@link Combobox}. A thin wrapper that skins the trigger to match
 * the 30px chip pill (`rounded-lg`, chip surface tokens) shared by
 * `ChipDropdown`, `ChipModal`, and `ChipInput`.
 *
 * Reuses 100% of `Combobox` — search, editable entry, multi-select, groups,
 * async loading, per-option icons, and `overlayContent` all work unchanged.
 * Only the trigger chrome is overridden (the `className` merges last in
 * `Combobox`, so `rounded-lg` / height / dark surface and the chip typography
 * — normal weight, `--text-body` — win over the heavier combobox defaults).
 * The muted placeholder still applies because the combobox tints the inner
 * label span with `--text-muted` independently of the trigger className.
 *
 * Use this in chip-styled surfaces (settings pages, chip forms). For the
 * lightweight no-search case, prefer `ChipDropdown`.
 *
 * @example
 * <ChipCombobox options={SOURCE_OPTIONS} value={source} onChange={setSource} />
 */
export function ChipCombobox({ className, ...props }: ComboboxProps) {
  return (
    <Combobox
      {...props}
      className={cn(
        'h-[30px] rounded-lg font-normal text-[var(--text-body)] dark:bg-[var(--surface-4)]',
        className
      )}
    />
  )
}
