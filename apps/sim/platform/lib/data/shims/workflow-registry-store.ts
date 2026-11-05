import { create } from 'zustand'
import type { WorkflowRegistry } from '@/stores/workflows/registry/types'

/**
 * Stands in for `stores/workflows/registry/store`. That store hydrates the canvas, and the Platform
 * has no canvas: a tool run executes on the server and only names its workflow here. Nothing else
 * reads this state, so hydration, the clipboard and paste stay inert rather than pull in every
 * block and trigger.
 */
export const useWorkflowRegistry = create<WorkflowRegistry>()((set) => ({
  activeWorkflowId: null,
  error: null,
  hydration: { phase: 'idle', workspaceId: null, workflowId: null, requestId: null, error: null },
  clipboard: null,
  pendingSelection: null,
  setActiveWorkflow: async (id) => set({ activeWorkflowId: id }),
  loadWorkflowState: async () => {},
  switchToWorkspace: () => {},
  markWorkflowCreating: () => {},
  markWorkflowCreated: () => {},
  copyBlocks: () => {},
  preparePasteData: () => null,
  hasClipboard: () => false,
  clearClipboard: () => {},
  setPendingSelection: () => {},
  clearPendingSelection: () => {},
  logout: () => set({ activeWorkflowId: null }),
}))
