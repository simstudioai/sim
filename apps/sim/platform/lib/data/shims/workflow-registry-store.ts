import { inertStore } from '@/platform/lib/data/shims/inert-store'
import type { WorkflowRegistry } from '@/stores/workflows/registry/types'

const registry: Pick<WorkflowRegistry, 'activeWorkflowId' | 'hydration' | 'setActiveWorkflow'> = {
  activeWorkflowId: null,
  hydration: { phase: 'idle', workspaceId: null, workflowId: null, requestId: null, error: null },
  setActiveWorkflow: async (id) => {
    registry.activeWorkflowId = id
  },
}

/**
 * Stands in for `stores/workflows/registry/store`, which hydrates a canvas and would pull in every
 * block and trigger. A tool run executes on the server and only names its workflow here.
 */
export const useWorkflowRegistry = inertStore('stores/workflows/registry/store', registry)
