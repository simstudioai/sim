export interface ConsoleEntry {
  id: string
  output: any
  error?: string
  warning?: string
  durationMs: number
  startedAt: string
  endedAt: string
  workflowId: string | null
  timestamp: string
  blockName?: string
  blockType?: string
  blockId?: string
}

export interface ConsoleStore {
  entries: ConsoleEntry[]
  isOpen: boolean
  addConsole: (entry: Omit<ConsoleEntry, 'id'>) => void
  clearConsole: (workflowId: string | null) => void
  getWorkflowEntries: (workflowId: string) => ConsoleEntry[]
  toggleConsole: () => void
}
