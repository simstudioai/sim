import safe from 'safe-regex2'

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
 * Validate a regex pattern's syntax and safety without matching it against input:
 * it must compile (`new RegExp`) and pass `safe-regex2`'s catastrophic-backtracking
 * screen. Shared by the custom-pattern editor UI and any pre-flight boundary check.
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

export function validateRegex(inputStr: string, pattern: string): ValidationResult {
  let regex: RegExp
  try {
    regex = new RegExp(pattern)
  } catch (error: any) {
    return { passed: false, error: `Invalid regex pattern: ${error.message}` }
  }

  if (!safe(pattern)) {
    return {
      passed: false,
      error: 'Regex pattern rejected: potentially unsafe (catastrophic backtracking)',
    }
  }

  const match = regex.test(inputStr)
  if (match) {
    return { passed: true }
  }
  return { passed: false, error: 'Input does not match regex pattern' }
}
