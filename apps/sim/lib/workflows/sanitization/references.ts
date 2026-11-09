import {
  findWorkflowReferenceTokens,
  isLikelyWorkflowReferenceSegment,
  splitWorkflowReferenceSegment,
} from '@sim/utils/workflow-references'

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
