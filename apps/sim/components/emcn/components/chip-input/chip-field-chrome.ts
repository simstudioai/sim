/** The bare filled-surface tokens shared by `chipVariants` filled and the chip text fields. */
export const chipFilledSurfaceTokens =
  'border border-[var(--border-1)] bg-[var(--surface-5)] dark:bg-[var(--surface-4)]'
/** Filled surface shared by the chip text fields ({@link ChipInput}, {@link ChipTextarea}) — aligned with `Chip` / `ChipDropdown`. */
export const chipFieldSurfaceClass = `rounded-lg ${chipFilledSurfaceTokens} transition-colors`
/** Typography shared by the chip text fields — normal weight, `--text-body`, muted placeholder, no focus outline. */
export const chipFieldTextClass =
  'text-[var(--text-body)] text-sm outline-none placeholder:text-[var(--text-muted)]'
