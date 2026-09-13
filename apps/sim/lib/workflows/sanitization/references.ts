import {
  findWorkflowReferenceTokens,
  isLikelyWorkflowReferenceSegment,
  splitWorkflowReferenceSegment,
} from '@sim/utils/workflow-references'
import { normalizeName, REFERENCE } from '@/executor/constants'

export const SYSTEM_REFERENCE_PREFIXES = new Set(['loop', 'parallel', 'variable'])

export const splitReferenceSegment = splitWorkflowReferenceSegment
export const isLikelyReferenceSegment = isLikelyWorkflowReferenceSegment

/**
 * Whether a subblock value carries a `<block.path>` / `<variable.name>` reference or a
 * `{{ENV_VAR}}` placeholder instead of a literal value — i.e. its real value is only known
 * once the workflow runs. Conditions that gate one field on a sibling's literal value use
 * this to stay visible while the sibling is bound dynamically.
 */
export function containsReference(value: unknown): boolean {
  if (typeof value !== 'string' || !value) {
    return false
  }
  return findWorkflowReferenceTokens(value).length > 0
}

/**
 * Split a comma-separated multi-select value without tearing a reference apart.
 *
 * A `<block.path>` or `{{ENV_VAR}}` token may legitimately contain a comma (`<start.pick(a,b)>`),
 * and its fragments read as plain literals once split, so a naive `.split(',')` turns one dynamic
 * value into several bogus ones. Only commas outside every reference token are separators.
 */
export function splitOutsideReferences(value: string): string[] {
  const tokens = findWorkflowReferenceTokens(value)
  if (tokens.length === 0) {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  }

  // Marked once up front rather than scanned per comma: a per-comma `tokens.some()` is
  // O(commas x tokens), which reached ~2.5s on a 240KB value of repeated `{{A}},`.
  const insideReference = new Uint8Array(value.length)
  for (const token of tokens) {
    const end = Math.min(token.end, value.length)
    for (let index = Math.max(token.start, 0); index < end; index += 1) {
      insideReference[index] = 1
    }
  }

  const parts: string[] = []
  let partStart = 0
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === ',' && !insideReference[index]) {
      parts.push(value.slice(partStart, index))
      partStart = index + 1
    }
  }
  parts.push(value.slice(partStart))

  return parts.map((part) => part.trim()).filter(Boolean)
}

export function extractReferencePrefixes(value: string): Array<{ raw: string; prefix: string }> {
  if (!value || typeof value !== 'string') {
    return []
  }

  const references: Array<{ raw: string; prefix: string }> = []

  for (const token of findWorkflowReferenceTokens(value)) {
    if (token.kind !== 'workflow') continue
    const inner = token.value.slice(REFERENCE.START.length, -REFERENCE.END.length)
    const [rawPrefix] = inner.split(REFERENCE.PATH_DELIMITER)
    if (!rawPrefix) continue

    const normalized = normalizeName(rawPrefix)
    references.push({ raw: token.value, prefix: normalized })
  }

  return references
}
