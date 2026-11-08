/**
 * What the right panel's Variables tab reads beyond the canvas seam: the legacy variable-name
 * sanitizer and the variable record's types. The store and collaborative writes cross through
 * `@/platform/lib/data/workflows`.
 */
export { validateName } from '@/lib/core/utils/validation'
export type { Variable, VariableType } from '@/stores/variables/types'
