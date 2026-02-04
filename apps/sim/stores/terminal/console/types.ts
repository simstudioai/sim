import type { NormalizedBlockOutput } from '@/executor/types'
import type { SubflowType } from '@/stores/workflows/workflow/types'

export interface ConsoleEntry {
  id: string
  timestamp: string
  workflowId: string
  blockId: string
  blockName: string
  blockType: string
  executionId?: string
  startedAt?: string
  executionOrder: number
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
  isRunning?: boolean
  isCanceled?: boolean
}

export interface ConsoleUpdate {
  content?: string
  output?: Partial<NormalizedBlockOutput>
  replaceOutput?: NormalizedBlockOutput
  error?: string | Error | null
  warning?: string
  success?: boolean
  startedAt?: string
  endedAt?: string
  durationMs?: number
  input?: any
  isRunning?: boolean
  isCanceled?: boolean
  iterationCurrent?: number
  iterationTotal?: number
  iterationType?: SubflowType
}

export interface ConsoleStore {
  entries: ConsoleEntry[]
  isOpen: boolean
  addConsole: (entry: Omit<ConsoleEntry, 'id' | 'timestamp'>) => ConsoleEntry
  clearWorkflowConsole: (workflowId: string) => void
  exportConsoleCSV: (workflowId: string) => void
  getWorkflowEntries: (workflowId: string) => ConsoleEntry[]
  toggleConsole: () => void
  updateConsole: (blockId: string, update: string | ConsoleUpdate, executionId?: string) => void
  cancelRunningEntries: (workflowId: string) => void
  _hasHydrated: boolean
  setHasHydrated: (hasHydrated: boolean) => void
}
