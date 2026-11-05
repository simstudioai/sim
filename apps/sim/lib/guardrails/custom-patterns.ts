import { validateRegexPattern } from '@/lib/guardrails/validate-regex'

/** Matches the `.max(20)` bound on `customPatterns` in the boundary contract. */
export const MAX_CUSTOM_PII_PATTERNS = 20

/**
 * The inline error for one pattern row. Syntax is the only check because these patterns execute in
 * Presidio, not in this process; see `validateRegexPattern` for why a backtracking screen here was
 * removed rather than kept.
 */
export function customPatternError(regex: string): string | undefined {
  const validation = regex.length > 0 ? validateRegexPattern(regex) : null
  return validation && !validation.valid ? validation.error : undefined
}
