import safe from 'safe-regex2'

const MAX_INPUT_LENGTH = 10_000

/**
 * Validate if input matches regex pattern
 */
export interface ValidationResult {
  passed: boolean
  error?: string
}

export function validateRegex(inputStr: string, pattern: string): ValidationResult {
  try {
    if (!safe(pattern)) {
      return { passed: false, error: 'Regex pattern rejected: potentially unsafe (catastrophic backtracking)' }
    }

    if (inputStr.length > MAX_INPUT_LENGTH) {
      return { passed: false, error: `Input exceeds maximum length of ${MAX_INPUT_LENGTH} characters` }
    }

    const regex = new RegExp(pattern)
    const match = regex.test(inputStr)

    if (match) {
      return { passed: true }
    }
    return { passed: false, error: 'Input does not match regex pattern' }
  } catch (error: any) {
    return { passed: false, error: `Invalid regex pattern: ${error.message}` }
  }
}
