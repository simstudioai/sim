/**
 * Validate if input matches regex pattern
 */
export interface ValidationResult {
  passed: boolean
  error?: string
}

export function validateRegex(inputStr: string, pattern: string): ValidationResult {
  try {
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
