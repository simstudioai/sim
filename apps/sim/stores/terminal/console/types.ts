import type { NormalizedBlockOutput } from '@/executor/types'
import type { SubflowType } from '@/stores/workflows/workflow/types'

/**
 * Console entry for terminal logs
 */
export interface ConsoleEntry {
  id: string
  timestamp: string
  workflowId: string
  blockId: string
  blockName: string
  blockType: string
  executionId?: string
  startedAt?: string
  endedAt?: string
  durationMs?: number
  success?: boolean
  input?: any
  output?: NormalizedBlockOutput
  error?: string | Error | null
  warning?: string
  iterationCurrent?: number
  iterationTotal?: number
  iterationType?: SubflowType
}

/**
 * Console update payload for partial updates
 */
export interface ConsoleUpdate {
  content?: string
  output?: Partial<NormalizedBlockOutput>
  replaceOutput?: NormalizedBlockOutput
  error?: string | Error | null
  warning?: string
  success?: boolean
  endedAt?: string
  durationMs?: number
  input?: any
}

/**
 * Console store state and actions
 */
export interface ConsoleStore {
  entries: ConsoleEntry[]
  isOpen: boolean
  addConsole: (entry: Omit<ConsoleEntry, 'id' | 'timestamp'>) => ConsoleEntry
  clearWorkflowConsole: (workflowId: string) => void
  clearConsole: (workflowId: string | null) => void
  exportConsoleCSV: (workflowId: string) => void
  getWorkflowEntries: (workflowId: string) => ConsoleEntry[]
  toggleConsole: () => void
  updateConsole: (blockId: string, update: string | ConsoleUpdate, executionId?: string) => void
}
