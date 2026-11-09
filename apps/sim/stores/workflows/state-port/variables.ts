import type { VariablesStore } from '@/stores/variables/types'
import { connectedWorkflowState } from '@/stores/workflows/state-port/connection'

const EMPTY: Pick<VariablesStore, 'variables'> = { variables: {} }

/**
 * The variables store as the operation queue reads it. A variable operation only queues in the
 * workflow editor, after the real store connects; before that none exist.
 */
export const useVariablesStore = {
  getState: () => connectedWorkflowState()?.variables.getState() ?? EMPTY,
}
