/**
 * Validate if input is valid JSON
 */
export interface ValidationResult {
  passed: boolean
  error?: string
}

export function validateJson(inputStr: string): ValidationResult {
  try {
    JSON.parse(inputStr)
    return { passed: true }
  } catch (error: any) {
    if (error instanceof SyntaxError) {
      return { passed: false, error: `Invalid JSON: ${error.message}` }
    }
    return { passed: false, error: `Validation error: ${error.message}` }
  }
}
