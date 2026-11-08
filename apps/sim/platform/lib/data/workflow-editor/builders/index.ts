/**
 * What the editor's table and builder inputs read beyond the main editor seam: the table query
 * builder, knowledge tag definitions and the fallback-model row transforms, unchanged.
 */

export { FIELD_TYPE_LABELS, getPlaceholderForFieldType } from '@/lib/knowledge/constants'
export { type FilterFieldType, getOperatorsForFieldType } from '@/lib/knowledge/filters/types'
export { useTableColumns } from '@/lib/table/hooks/use-table-columns'
export { SORT_DIRECTION_OPTIONS } from '@/lib/table/query-builder/constants'
export { useFilterBuilder } from '@/lib/table/query-builder/use-query-builder'
export type { ColumnOption, FilterRule, SortRule } from '@/lib/table/types'
export {
  addFallbackRow,
  changeFallbackRowApiKey,
  changeFallbackRowModel,
  changeFallbackRowTuning,
  FALLBACK_TUNING_LABELS,
  type FallbackModelEntry,
  type FallbackTuningKnob,
  fallbackRowNeedsApiKey,
  getFallbackTuningKnobsToShow,
  getTuningOptionsForModel,
  isWholeEnvVarReference,
  MAX_FALLBACK_MODELS,
  moveFallbackRow,
  ordinalChoiceLabel,
  removeFallbackRow,
} from '@/lib/workflows/blocks/fallback-models'
export { useKnowledgeBaseTagDefinitions } from '@/hooks/kb/use-knowledge-base-tag-definitions'
export {
  createEmptyTableRow,
  normalizeTableRows,
  tableCellText,
  type WorkflowTableRow,
} from './table-rows'
export { type FallbackModelOption, useFallbackModelOptions } from './use-fallback-model-options'
export {
  type SecretReferenceOption,
  useSecretReferenceOptions,
} from './use-secret-reference-options'
