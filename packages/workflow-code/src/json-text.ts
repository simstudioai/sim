/**
 * JSON-text decoding shared by canonicalize, the app's deploy-change detection and the executor.
 * Dependency-free so client bundles and the executor can import it without the compiler.
 */

/**
 * Field types whose runtime reads JSON text and the container it encodes alike: the workflow
 * handler and the tool runners parse a child workflow's `inputMapping` either way, and the
 * operations route stores either. Canonicalize decodes the text so it prints as the object source
 * can type, deploy-change detection takes the two encodings as one value, and the executor
 * escapes a reference spliced into the text's string literals. Any other native
 * container field stays as stored, since its runtime reads only one form.
 */
export const JSON_TEXT_CONTAINER_TYPES: ReadonlySet<string> = new Set([
  'input-mapping',
  'workflow-input-mapper',
])

/**
 * JSON text that holds an object or array, decoded; `undefined` for blank text, text that does not
 * parse, and a scalar, which callers keep as the text it is.
 */
export function parseJsonContainer(text: string): Record<string, unknown> | unknown[] | undefined {
  if (text.trim() === '') return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown> | unknown[])
      : undefined
  } catch {
    return undefined
  }
}
