import { create } from 'zustand'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * Stands in for `stores/workflows/workflow/store`. With no canvas nothing hydrates a workflow here,
 * so the run stream finds no edges to mark and a tool title falls back to its generic label.
 */
export const useWorkflowStore = create<
  Pick<WorkflowState, 'blocks' | 'edges' | 'loops' | 'parallels'>
>()(() => ({
  blocks: {},
  edges: [],
  loops: {},
  parallels: {},
}))
