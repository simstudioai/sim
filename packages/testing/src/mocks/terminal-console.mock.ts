import { generateRandomString } from '@sim/utils/random'
import { vi } from 'vitest'

interface ConsoleEntryLike {
  id?: string
  workflowId: string
  blockId: string
  blockType: string
  executionId?: string
  isRunning?: boolean
  error?: string | null
  [key: string]: unknown
}

const entriesByWorkflow: Record<string, ConsoleEntryLike[]> = {}

const mockGetWorkflowEntries = vi.fn((workflowId: string) => entriesByWorkflow[workflowId] ?? [])

const mockAddConsole = vi.fn((entry: ConsoleEntryLike) => {
  const stored = { ...entry, id: entry.id ?? `mock-${generateRandomString(16)}` }
  if (!entriesByWorkflow[entry.workflowId]) entriesByWorkflow[entry.workflowId] = []
  entriesByWorkflow[entry.workflowId].push(stored)
  return stored
})

const mockUpdateConsole = vi.fn()
const mockCancelRunningEntries = vi.fn()
const mockClearWorkflowConsole = vi.fn((workflowId: string) => {
  delete entriesByWorkflow[workflowId]
})

/** Stand-in for the `consolePersistence` manager: scoped executions are opaque tokens. */
const mockConsolePersistence = {
  bind: vi.fn(),
  executionStarted: vi.fn(() => ({})),
  beginScopedExecution: vi.fn(() => ({})),
  adoptScopedExecution: vi.fn((): object | undefined => undefined),
  onRunningEntryAdded: vi.fn(),
  executionEnded: vi.fn(),
  endScopedExecution: vi.fn(() => true),
  persist: vi.fn(async () => undefined),
  reset: vi.fn(),
}
const mockLoadExecutionPointer = vi.fn(async (): Promise<unknown> => null)
const mockSaveExecutionPointer = vi.fn(async () => undefined)
const mockClearExecutionPointer = vi.fn(async () => undefined)
const mockClearAllExecutionPointers = vi.fn()
const mockWaitForConsoleHydration = vi.fn(async () => undefined)

/**
 * Resets the in-memory mock console store. Call from `beforeEach` if your tests
 * push entries via `terminalConsoleMockFns.mockAddConsole`.
 */
export function resetTerminalConsoleMock(): void {
  for (const key of Object.keys(entriesByWorkflow)) delete entriesByWorkflow[key]
  mockGetWorkflowEntries.mockClear()
  mockAddConsole.mockClear()
  mockUpdateConsole.mockClear()
  mockCancelRunningEntries.mockClear()
  mockClearWorkflowConsole.mockClear()
}

const stateValue = {
  addConsole: mockAddConsole,
  updateConsole: mockUpdateConsole,
  cancelRunningEntries: mockCancelRunningEntries,
  clearWorkflowConsole: mockClearWorkflowConsole,
  getWorkflowEntries: mockGetWorkflowEntries,
  workflowEntries: entriesByWorkflow,
  entryIdsByBlockExecution: {},
  entryLocationById: {},
  isOpen: false,
  _hasHydrated: true,
}

/**
 * The store hook. The default ignores the selector and returns the whole mock state; a test that
 * needs selector semantics or its own state sets `mockImplementation` / `getState.mockReturnValue`.
 */
const mockUseTerminalConsoleStore = Object.assign(
  vi.fn((_selector?: (state: never) => unknown): unknown => stateValue),
  {
    getState: vi.fn((): unknown => stateValue),
    setState: vi.fn(),
    subscribe: vi.fn(),
  }
)

/**
 * Controllable mock fns for `@/stores/terminal` and `@/stores/terminal/console/store`.
 * Includes a tiny in-memory store backing `getWorkflowEntries`/`addConsole` so callers
 * exercising the read-after-write contract behave correctly without the real Zustand store.
 */
export const terminalConsoleMockFns = {
  mockGetWorkflowEntries,
  mockAddConsole,
  mockUpdateConsole,
  mockCancelRunningEntries,
  mockClearWorkflowConsole,
  mockConsolePersistence,
  mockExecutionStarted: mockConsolePersistence.executionStarted,
  mockExecutionEnded: mockConsolePersistence.executionEnded,
  mockPersist: mockConsolePersistence.persist,
  mockLoadExecutionPointer,
  mockSaveExecutionPointer,
  mockClearExecutionPointer,
  mockClearAllExecutionPointers,
  mockWaitForConsoleHydration,
  mockUseTerminalConsoleStore,
  reset: resetTerminalConsoleMock,
}

/**
 * Static mock module for `@/stores/terminal` / `@/stores/terminal/console/store`.
 *
 * @example
 * ```ts
 * vi.mock('@/stores/terminal', () => terminalConsoleMock)
 * ```
 */
export const terminalConsoleMock = {
  useTerminalConsoleStore: mockUseTerminalConsoleStore,
  consolePersistence: mockConsolePersistence,
  loadExecutionPointer: mockLoadExecutionPointer,
  saveExecutionPointer: mockSaveExecutionPointer,
  clearExecutionPointer: mockClearExecutionPointer,
  clearAllExecutionPointers: mockClearAllExecutionPointers,
  waitForConsoleHydration: mockWaitForConsoleHydration,
}
