import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { compileLinearRegex } from '@/lib/core/security/linear-regex'

const logger = createLogger('ValidateRegex')

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
 * Syntax only, deliberately. This previously also ran a `safe-regex2`
 * catastrophic-backtracking screen, which was removed because it was pure cost:
 * it screens star height alone and is documented as having false negatives — it
 * passes `(a|a)*b`, and `a*a*b` defeats it and every syntactic rule of its kind
 * — while rejecting patterns that work perfectly well, including lookbehind
 * (`(?<=id: )\w+`) and optional groups (`(?:https?://)?example\.com`). It
 * blocked valid rules and stopped nothing.
 *
 * Nor could a screen here be made sound: these patterns execute in Presidio's
 * Python engine, which backtracks on shapes RE2 accepts, so RE2-representability
 * says nothing about their runtime there. Presidio's own request timeout is the
 * real bound — note it fails open on timeout, leaving PII unredacted.
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
    return { valid: false, error: `Invalid regex: ${getErrorMessage(error)}` }
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
    // A rule that used lookaround worked before this became RE2-only and now
    // fails closed, which reads to the workspace as the guardrail tripping on
    // every input. Log it so an operator can find and rewrite the rule from
    // logs rather than from user reports.
    logger.warn('Guardrail regex uses syntax RE2 cannot evaluate; failing closed', { pattern })
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
