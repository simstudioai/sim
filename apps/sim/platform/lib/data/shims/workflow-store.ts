import { inertStore } from '@/platform/lib/data/shims/inert-store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const workflow: Pick<WorkflowState, 'blocks' | 'edges'> = { blocks: {}, edges: [] }

/**
 * Stands in for `stores/workflows/workflow/store`. With no canvas nothing hydrates a workflow here,
 * so the run stream finds no edges to mark and a tool title falls back to its generic label.
 */
export const useWorkflowStore = inertStore('stores/workflows/workflow/store', workflow)
