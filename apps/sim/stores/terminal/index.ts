export type { ConsoleEntry, ConsoleStore, ConsoleUpdate } from './console'
export {
  normalizeConsoleError,
  normalizeConsoleInput,
  normalizeConsoleOutput,
  safeConsoleStringify,
  TERMINAL_CONSOLE_LIMITS,
  trimConsoleEntries,
  trimWorkflowConsoleEntries,
  useConsoleEntry,
  useTerminalConsoleStore,
  useWorkflowConsoleEntries,
} from './console'
export { useTerminalStore } from './store'
export type { TerminalState } from './types'
