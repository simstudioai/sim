'use client'

import { Combobox, type ComboboxProps } from '@/components/emcn/components/combobox/combobox'
import { cn } from '@/lib/core/utils/cn'

/**
 * Chip-styled {@link Combobox}. A thin wrapper that skins the trigger to match
 * the 30px chip pill (`rounded-lg`, chip surface tokens) shared by
 * `ChipDropdown`, `ChipModal`, and `Input variant='chip'`.
 *
 * Reuses 100% of `Combobox` — search, editable entry, multi-select, groups,
 * async loading, per-option icons, and `overlayContent` all work unchanged.
 * Only the trigger chrome is overridden (the `className` merges last in
 * `Combobox`, so `rounded-lg` / height / dark surface win over the defaults).
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
      className={cn('h-[30px] rounded-lg dark:bg-[var(--surface-4)]', className)}
    />
  )
}
