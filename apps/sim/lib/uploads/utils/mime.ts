/** Returns the lowercase media type without parameters for format matching. */
export function normalizeMimeType(mimeType: string | null | undefined): string {
  return mimeType?.split(';', 1)[0].trim().toLowerCase() ?? ''
}
