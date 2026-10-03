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

/**
 * Escapes text so it cannot terminate whatever JavaScript literal it is spliced into.
 *
 * Condition expressions are user-authored JavaScript into which resolved references are
 * inlined as source, so the author's quoting — not this module's — decides which string
 * context the value lands in. Escaping only the quote the emitted literal opens leaves
 * `"`, a backtick, `${`, and `/` live, and `"<start.input>".includes('urgent')` then lets
 * trigger data close the author's string and run as code in the condition sandbox.
 *
 * So every terminator of every JavaScript string context is escaped, not just the one the
 * emitted literal opens. `\"`, `` \` ``, `\$`, and `\/` are identity escapes in JavaScript,
 * so the value a condition compares is byte-identical to what it was before — this is a
 * syntax guard, not a value transform.
 *
 * JavaScript only: `\$`, `` \` `` and `\/` are not identity escapes in Python, where they
 * would change the value. Code blocks bind their values as runtime context variables
 * instead of splicing them, which is why they need no escaping in any language.
 */
export function escapeInertStringContent(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/['"`$/]/g, '\\$&')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** Wraps {@link escapeInertStringContent} output as a complete JavaScript string literal. */
export function formatInertStringLiteral(value: string, quote: '"' | "'" = "'"): string {
  return `${quote}${escapeInertStringContent(value)}${quote}`
}
