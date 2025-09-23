import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import {
  computeEditSequence,
  type EditOperation,
} from '@/lib/workflows/training/compute-edit-sequence'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('CopilotTrainingStore')

export interface TrainingDataset {
  id: string
  workflowId: string
  prompt: string
  startState: WorkflowState
  endState: WorkflowState
  editSequence: EditOperation[]
  createdAt: Date
  metadata?: {
    duration?: number // Time taken to complete edits in ms
    blockCount?: number
    edgeCount?: number
  }
}

interface CopilotTrainingState {
  // Current training session
  isTraining: boolean
  currentPrompt: string
  startSnapshot: WorkflowState | null
  startTime: number | null

  // Completed datasets
  datasets: TrainingDataset[]

  // UI state
  showModal: boolean

  // Actions
  startTraining: (prompt: string) => void
  stopTraining: () => TrainingDataset | null
  cancelTraining: () => void
  setPrompt: (prompt: string) => void
  toggleModal: () => void
  clearDatasets: () => void
  exportDatasets: () => string
}

/**
 * Get a clean snapshot of the current workflow state
 */
function captureWorkflowSnapshot(): WorkflowState {
  const rawState = useWorkflowStore.getState().getWorkflowState()

  // Merge subblock values to get complete state
  const blocksWithSubblockValues = mergeSubblockState(rawState.blocks)

  // Clean the state - only include essential fields
  return {
    blocks: blocksWithSubblockValues,
    edges: rawState.edges || [],
    loops: rawState.loops || {},
    parallels: rawState.parallels || {},
    lastSaved: Date.now(),
  }
}

export const useCopilotTrainingStore = create<CopilotTrainingState>()(
  devtools(
    (set, get) => ({
      // Initial state
      isTraining: false,
      currentPrompt: '',
      startSnapshot: null,
      startTime: null,
      datasets: [],
      showModal: false,

      // Start a new training session
      startTraining: (prompt: string) => {
        if (!prompt.trim()) {
          logger.warn('Cannot start training without a prompt')
          return
        }

        const snapshot = captureWorkflowSnapshot()

        logger.info('Starting training session', {
          prompt,
          blockCount: Object.keys(snapshot.blocks).length,
          edgeCount: snapshot.edges.length,
        })

        set({
          isTraining: true,
          currentPrompt: prompt,
          startSnapshot: snapshot,
          startTime: Date.now(),
          showModal: false, // Close modal when starting
        })
      },

      // Stop training and save the dataset
      stopTraining: () => {
        const state = get()

        if (!state.isTraining || !state.startSnapshot) {
          logger.warn('No active training session to stop')
          return null
        }

        const endSnapshot = captureWorkflowSnapshot()
        const duration = state.startTime ? Date.now() - state.startTime : 0

        // Compute the edit sequence
        const { operations, summary } = computeEditSequence(state.startSnapshot, endSnapshot)

        // Get workflow ID from the store
        const { activeWorkflowId } = useWorkflowStore.getState() as any

        const dataset: TrainingDataset = {
          id: crypto.randomUUID(),
          workflowId: activeWorkflowId || 'unknown',
          prompt: state.currentPrompt,
          startState: state.startSnapshot,
          endState: endSnapshot,
          editSequence: operations,
          createdAt: new Date(),
          metadata: {
            duration,
            blockCount: Object.keys(endSnapshot.blocks).length,
            edgeCount: endSnapshot.edges.length,
          },
        }

        logger.info('Training session completed', {
          prompt: state.currentPrompt,
          duration,
          operations: operations.length,
          summary,
        })

        set((prev) => ({
          isTraining: false,
          currentPrompt: '',
          startSnapshot: null,
          startTime: null,
          datasets: [...prev.datasets, dataset],
        }))

        return dataset
      },

      // Cancel training without saving
      cancelTraining: () => {
        logger.info('Training session cancelled')

        set({
          isTraining: false,
          currentPrompt: '',
          startSnapshot: null,
          startTime: null,
        })
      },

      // Update the prompt
      setPrompt: (prompt: string) => {
        set({ currentPrompt: prompt })
      },

      // Toggle modal visibility
      toggleModal: () => {
        set((state) => ({ showModal: !state.showModal }))
      },

      // Clear all datasets
      clearDatasets: () => {
        logger.info('Clearing all training datasets')
        set({ datasets: [] })
      },

      // Export datasets as JSON
      exportDatasets: () => {
        const { datasets } = get()

        const exportData = {
          version: '1.0',
          exportedAt: new Date().toISOString(),
          datasets: datasets.map((d) => ({
            id: d.id,
            workflowId: d.workflowId,
            prompt: d.prompt,
            startState: d.startState,
            endState: d.endState,
            editSequence: d.editSequence,
            createdAt: d.createdAt.toISOString(),
            metadata: d.metadata,
          })),
        }

        return JSON.stringify(exportData, null, 2)
      },
    }),
    {
      name: 'copilot-training-store',
    }
  )
)
