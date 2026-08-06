interface ShouldClearMissingOptionParams {
  clearOnMissingOption: boolean
  missingOptionId: string | null
  currentValue: unknown
  isPreview: boolean
  disabled: boolean
}

/** Guards the authoritative missing-option clear against stale lookup results and read-only views. */
export function shouldClearMissingOption({
  clearOnMissingOption,
  missingOptionId,
  currentValue,
  isPreview,
  disabled,
}: ShouldClearMissingOptionParams): boolean {
  return (
    clearOnMissingOption &&
    Boolean(missingOptionId) &&
    !isPreview &&
    !disabled &&
    currentValue === missingOptionId
  )
}
