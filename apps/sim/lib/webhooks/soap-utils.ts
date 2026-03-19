export interface ParsedSoapEnvelope {
  [key: string]: unknown
}

/**
 * Extracts the SOAP body content from a parsed XML-to-JSON object.
 * Strips the Envelope and Body wrappers, returning the first operation element inside.
 */
export function extractSoapBody(parsed: ParsedSoapEnvelope): Record<string, unknown> {
  const envelope = findValueByLocalName(parsed, 'Envelope') as Record<string, unknown> | undefined
  if (!envelope) return parsed

  const body = findValueByLocalName(envelope, 'Body') as Record<string, unknown> | undefined
  if (!body) return envelope

  const operationKeys = Object.keys(body).filter((k) => !k.startsWith('@_'))
  if (operationKeys.length === 1) {
    return body[operationKeys[0]] as Record<string, unknown>
  }

  return body
}

/**
 * Recursively strips XML namespace prefixes from all object keys.
 * "wd:Event_Name" becomes "Event_Name", "env:Body" becomes "Body".
 */
export function stripNamespacePrefixes(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj

  if (Array.isArray(obj)) {
    return obj.map(stripNamespacePrefixes)
  }

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const strippedKey = key.includes(':') ? key.split(':').pop()! : key
    result[strippedKey] = stripNamespacePrefixes(value)
  }
  return result
}

/**
 * Finds a value in an object by local name (ignoring namespace prefix).
 * e.g., findValueByLocalName(obj, "Envelope") matches "env:Envelope", "soap:Envelope", "Envelope"
 */
function findValueByLocalName(
  obj: Record<string, unknown>,
  localName: string
): unknown | undefined {
  if (obj[localName] !== undefined) return obj[localName]

  for (const key of Object.keys(obj)) {
    const local = key.includes(':') ? key.split(':').pop() : key
    if (local === localName) return obj[key]
  }

  return undefined
}
