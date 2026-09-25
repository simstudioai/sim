/**
 * A value that is exactly one `{{NAME}}` environment-variable reference, with the
 * variable name captured. Embedded references (`prefix-{{NAME}}`) do not match.
 */
export const EXACT_ENVIRONMENT_REFERENCE = /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/

/** Returns the referenced variable name when `value` is a whole-value `{{NAME}}` reference. */
export function parseExactEnvironmentReference(value: string | undefined): string | undefined {
  return value?.match(EXACT_ENVIRONMENT_REFERENCE)?.[1]
}
