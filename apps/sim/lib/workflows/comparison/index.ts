export type { FieldChange, WorkflowDiffSummary } from './compare'
export {
  formatDiffSummaryForDescription,
  generateWorkflowDiffSummary,
  hasWorkflowChanged,
} from './compare'
export type { NormalizedWorkflowState } from './normalize'
export {
  normalizedStringify,
  normalizeEdge,
  normalizeLoop,
  normalizeParallel,
  normalizeValue,
  normalizeVariables,
  normalizeWorkflowState,
  sanitizeInputFormat,
  sanitizeTools,
  sanitizeVariable,
  sortEdges,
} from './normalize'
