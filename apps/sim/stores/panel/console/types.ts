import type { NormalizedBlockOutput } from '@/executor/types'

export interface ConsoleEntry {
  id: string
  timestamp: string
  workflowId: string
  blockId: string
  executionId?: string
  blockName?: string
  blockType?: string
  startedAt?: string
  endedAt?: string
  durationMs?: number
  success: boolean
  output?: NormalizedBlockOutput
  input?: any
  error?: string
  warning?: string
}

export interface ConsoleUpdate {
  content?: string
  input?: any
  output?: Partial<NormalizedBlockOutput>
  replaceOutput?: NormalizedBlockOutput // New field for complete replacement
  error?: string
  warning?: string
  success?: boolean
  endedAt?: string
  durationMs?: number
}

export interface ConsoleStore {
  entries: ConsoleEntry[]
  isOpen: boolean

  addConsole: (entry: Omit<ConsoleEntry, 'id' | 'timestamp'>) => ConsoleEntry
  clearConsole: (workflowId: string | null) => void
  exportConsoleCSV: (workflowId: string) => void
  getWorkflowEntries: (workflowId: string) => ConsoleEntry[]
  toggleConsole: () => void
  updateConsole: (blockId: string, update: string | ConsoleUpdate, executionId?: string) => void
}
