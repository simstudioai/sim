import type { EditOperation } from '@/lib/workflows/training/compute-edit-sequence'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

export interface TrainingDataset {
  id: string
  workflowId: string
  title: string
  prompt: string
  startState: WorkflowState
  endState: WorkflowState
  editSequence: EditOperation[]
  createdAt: Date
  sentAt?: Date
  metadata?: {
    duration?: number // Time taken to complete edits in ms
    blockCount?: number
    edgeCount?: number
  }
}

export interface CopilotTrainingState {
  // Current training session
  isTraining: boolean
  currentTitle: string
  currentPrompt: string
  startSnapshot: WorkflowState | null
  startTime: number | null

  // Completed datasets
  datasets: TrainingDataset[]

  // UI state
  showModal: boolean

  // Actions
  startTraining: (title: string, prompt: string) => void
  stopTraining: () => TrainingDataset | null
  cancelTraining: () => void
  setPrompt: (prompt: string) => void
  toggleModal: () => void
  clearDatasets: () => void
  exportDatasets: () => string
  markDatasetSent: (id: string, sentAt?: Date) => void
}
