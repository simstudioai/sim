import safe from 'safe-regex2'

/**
 * Validate if input matches regex pattern
 */
export interface ValidationResult {
  passed: boolean
  error?: string
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
