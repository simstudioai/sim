export type { ConsoleEntry, ConsoleStore, ConsoleUpdate } from './console'
export {
  clearExecutionPointer,
  consolePersistence,
  type ExecutionPointer,
  loadExecutionPointer,
  normalizeConsoleError,
  normalizeConsoleInput,
  normalizeConsoleOutput,
  safeConsoleStringify,
  saveExecutionPointer,
  TERMINAL_CONSOLE_LIMITS,
  trimConsoleEntries,
  trimWorkflowConsoleEntries,
  useConsoleEntry,
  useTerminalConsoleStore,
  useWorkflowConsoleEntries,
} from './console'
export { useTerminalStore } from './store'
export type { TerminalState } from './types'
