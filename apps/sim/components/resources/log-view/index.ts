/**
 * The log resource view. Consumers mount {@link LogView} against a source,
 * grants, and a host; everything else here is what the surrounding surfaces
 * (the logs table, the logs page's snapshot modal) need to describe a run
 * without opening its details panel.
 */

export { ExecutionSnapshot } from './components/execution-snapshot'
export type { LogViewProps, LogViewTab } from './log-view'
export { LogView, WorkflowOutputSection } from './log-view'
export { DELETED_WORKFLOW_LABEL, formatDate, TriggerBadge } from './utils/log-presentation'
export {
  adjustBgForContrast,
  getBlockIconAndColor,
  iconColorClass,
} from './utils/trace-utils'
