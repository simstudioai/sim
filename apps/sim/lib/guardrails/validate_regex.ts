import { getErrorMessage } from '@sim/utils/errors'
import safe from 'safe-regex2'
import { compileLinearRegex } from '@/lib/core/security/linear-regex'

/**
 * Validate if input matches regex pattern
 */
export interface ValidationResult {
  passed: boolean
  error?: string
}

/** Result of validating a regex pattern's syntax and safety (independent of any input). */
export interface RegexPatternValidation {
  valid: boolean
  error?: string
}

/**
 * Validate a PII custom pattern's syntax before it is persisted and handed to
 * Presidio. Shared by the custom-pattern editor UI and the write boundary.
 *
 * The `safe-regex2` screen here is a courtesy, NOT a ReDoS defense: it screens
 * star height only and is documented as having false negatives — it passes
 * `(a|a)*b`, and `a*a*b` defeats every syntactic rule of this kind. It is kept
 * because these patterns execute in Presidio, a separate service where a slow
 * pattern times out and silently fails open (leaving PII unredacted) rather
 * than stalling this event loop, and because Presidio's Python engine supports
 * lookaround — so gating on RE2 here would reject patterns that work.
 *
 * Anything that matches a caller-supplied pattern *in this process* must use
 * `compileLinearRegex` from `@/lib/core/security/linear-regex` instead.
 */
export function validateRegexPattern(pattern: string): RegexPatternValidation {
  if (pattern.length === 0) {
    return { valid: false, error: 'Pattern cannot be empty' }
  }
  try {
    new RegExp(pattern)
  } catch (error) {
    return { valid: false, error: `Invalid regex: ${(error as Error).message}` }
  }
  if (!safe(pattern)) {
    return {
      valid: false,
      error: 'Pattern rejected: potentially unsafe (catastrophic backtracking)',
    }
  }
  return { valid: true }
}

/**
 * Match `inputStr` against a caller-defined guardrail `pattern`.
 *
 * Both the pattern and the input are caller-influenced and this runs on the
 * shared event loop, so matching goes through RE2 — a backtracking engine here
 * lets one guardrail rule stall every other request on the instance. Patterns
 * RE2 cannot represent (lookaround, backreferences) are reported rather than
 * run on the built-in engine, which would reintroduce that exposure.
 */
export function validateRegex(inputStr: string, pattern: string): ValidationResult {
  try {
    new RegExp(pattern)
  } catch (error) {
    return { passed: false, error: `Invalid regex pattern: ${getErrorMessage(error)}` }
  }

  const regex = compileLinearRegex(pattern)
  if (!regex) {
    return {
      passed: false,
      error:
        'Regex pattern uses syntax that cannot be evaluated safely (lookahead, lookbehind and backreferences are unsupported). Rewrite it without those constructs.',
    }
  }

  if (regex.test(inputStr)) {
    return { passed: true }
  }
  return { passed: false, error: 'Input does not match regex pattern' }
}
