import { connectedWorkflowState } from '@/platform/lib/data/shims/workflow-state/connection'
import type { VariablesStore } from '@/stores/variables/types'

const EMPTY: Pick<VariablesStore, 'variables'> = { variables: {} }

/**
 * Stands in for `stores/variables/store` where the operation queue requires it. A variable operation
 * only queues on the Workflows tab, after it connects the real store; before that none exist.
 */
export const useVariablesStore = {
  getState: () => connectedWorkflowState()?.variables.getState() ?? EMPTY,
}
