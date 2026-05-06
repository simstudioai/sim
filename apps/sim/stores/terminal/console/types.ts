import type { ParentIteration } from '@/executor/execution/types'
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
  iterationContainerId?: string
  parentIterations?: ParentIteration[]
  isRunning?: boolean
  isCanceled?: boolean
  /** ID of the workflow block in the parent execution that spawned this child block */
  childWorkflowBlockId?: string
  /** Display name of the child workflow this block belongs to */
  childWorkflowName?: string
  /** Per-invocation unique ID linking this workflow block to its child block events */
  childWorkflowInstanceId?: string
}

export interface ConsoleUpdate {
  content?: string
  output?: Partial<NormalizedBlockOutput>
  replaceOutput?: NormalizedBlockOutput
  executionOrder?: number
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
  iterationContainerId?: string
  parentIterations?: ParentIteration[]
  childWorkflowBlockId?: string
  childWorkflowName?: string
  childWorkflowInstanceId?: string
}

export interface ConsoleEntryLocation {
  workflowId: string
  index: number
}

export interface ConsoleStore {
  workflowEntries: Record<string, ConsoleEntry[]>
  entryIdsByBlockExecution: Record<string, string[]>
  entryLocationById: Record<string, ConsoleEntryLocation>
  isOpen: boolean
  addConsole: (entry: Omit<ConsoleEntry, 'id' | 'timestamp'>) => ConsoleEntry | undefined
  clearWorkflowConsole: (workflowId: string) => void
  clearExecutionEntries: (executionId: string) => void
  exportConsoleCSV: (workflowId: string) => void
  getWorkflowEntries: (workflowId: string) => ConsoleEntry[]
  toggleConsole: () => void
  updateConsole: (blockId: string, update: string | ConsoleUpdate, executionId?: string) => void
  cancelRunningEntries: (workflowId: string, executionId?: string) => void
  finishRunningEntries: (workflowId: string, executionId?: string) => void
  _hasHydrated: boolean
}
