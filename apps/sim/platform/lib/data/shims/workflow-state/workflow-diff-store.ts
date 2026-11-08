import { requireWorkflowState } from '@/platform/lib/data/shims/workflow-state/connection'

/**
 * Stands in for `stores/workflow-diff/store` where the shared socket provider imports it. Its
 * join-state handler runs only in a workflow room, by which time the real store is connected.
 */
export const useWorkflowDiffStore = {
  getState: () => requireWorkflowState().diff.getState(),
}
