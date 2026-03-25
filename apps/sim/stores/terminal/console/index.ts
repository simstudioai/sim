export { indexedDBStorage } from './storage'
export { useTerminalConsoleStore } from './store'
export type { ConsoleEntry, ConsoleStore, ConsoleUpdate } from './types'
export {
  normalizeConsoleError,
  normalizeConsoleInput,
  normalizeConsoleOutput,
  safeConsoleStringify,
  TERMINAL_CONSOLE_LIMITS,
  trimConsoleEntries,
} from './utils'
