import { requireWorkflowState } from '@/platform/lib/data/shims/workflow-state/connection'
import type { SubBlockStore } from '@/stores/workflows/subblock/types'

/**
 * Stands in for `stores/workflows/subblock/store` where the shared socket provider imports it. Its
 * join-state handler runs only in a workflow room, by which time the real store is connected.
 */
export const useSubBlockStore = {
  setState: (update: (state: SubBlockStore) => Partial<SubBlockStore>) =>
    requireWorkflowState().subBlock.setState(update),
}
