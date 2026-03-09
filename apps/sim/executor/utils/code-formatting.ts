/**
 * Formats a JavaScript/TypeScript value as a code literal for the target language.
 * Handles special cases like null, undefined, booleans, and Python-specific number representations.
 *
 * @param value - The value to format
 * @param language - Target language ('javascript' or 'python')
 * @returns A string literal representation valid in the target language
 *
 * @example
 * formatLiteralForCode(null, 'python') // => 'None'
 * formatLiteralForCode(true, 'python') // => 'True'
 * formatLiteralForCode(NaN, 'python')  // => "float('nan')"
 * formatLiteralForCode("hello", 'javascript') // => '"hello"'
 * formatLiteralForCode({a: 1}, 'python') // => "json.loads('{\"a\":1}')"
 */
export function formatLiteralForCode(value: unknown, language: 'javascript' | 'python'): string {
  const isPython = language === 'python'

  if (value === undefined) {
    return isPython ? 'None' : 'undefined'
  }
  if (value === null) {
    return isPython ? 'None' : 'null'
  }
  if (typeof value === 'boolean') {
    return isPython ? (value ? 'True' : 'False') : String(value)
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      return isPython ? "float('nan')" : 'NaN'
    }
    if (value === Number.POSITIVE_INFINITY) {
      return isPython ? "float('inf')" : 'Infinity'
    }
    if (value === Number.NEGATIVE_INFINITY) {
      return isPython ? "float('-inf')" : '-Infinity'
    }
    return String(value)
  }
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  // Objects and arrays - Python needs json.loads() because JSON true/false/null aren't valid Python
  if (isPython) {
    return `json.loads(${JSON.stringify(JSON.stringify(value))})`
  }
  return JSON.stringify(value)
}
