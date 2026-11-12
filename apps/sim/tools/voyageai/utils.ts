/** Reads a list-valued param that may arrive as an array or as a JSON string. */
function parseJsonList(value: unknown, label: string): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed
    } catch {}
  }
  throw new Error(`${label} must be a JSON array`)
}

/**
 * Validates the `inputs` of a contextualized request for the given input type.
 *
 * Voyage's server chunks documents itself (`enable_auto_chunking` needs
 * `input_type: 'document'` and rejects any inner list), so a document is one
 * string. Queries are not chunked: a flat list, or one single-query list each.
 */
export function parseContextualizedInputs(
  value: unknown,
  inputType: 'document' | 'query'
): string[] | string[][] {
  const items = parseJsonList(value, 'Input')
  if (items.length === 0) throw new Error('Input must contain at least one text')
  const isText = (item: unknown): item is string => typeof item === 'string' && item.trim() !== ''
  if (items.every(isText)) return items
  if (inputType === 'document') {
    throw new Error(
      'In document mode each input must be one non-empty text, the full document: Voyage splits it into chunks itself'
    )
  }
  if (items.every((item) => Array.isArray(item) && item.length > 0 && item.every(isText))) {
    return items as string[][]
  }
  throw new Error('Input must be a list of non-empty texts')
}

export function requireInputType(value: unknown): 'document' | 'query' {
  if (value === 'document' || value === 'query') return value
  throw new Error('Input type is required: document or query')
}

export function parseDocumentTexts(value: unknown): string[] {
  const documents = parseJsonList(value, 'Documents')
  if (documents.length === 0) throw new Error('Documents must contain at least one text')
  if (!documents.every((text) => typeof text === 'string' && text.trim() !== '')) {
    throw new Error('Documents must be a list of non-empty texts')
  }
  return documents as string[]
}

/** Coerces an optional numeric param that a block may hand over as a string. */
export function toOptionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${label} must be a positive integer`)
  return parsed
}

/** Voyage models differ in cost, context and use, so the caller always names one. */
export function requireModel(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Model is required')
  return value.trim()
}
