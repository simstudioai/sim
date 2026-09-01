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
