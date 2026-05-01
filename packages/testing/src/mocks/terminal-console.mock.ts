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
  const stored = { ...entry, id: entry.id ?? `mock-${Math.random().toString(36).slice(2)}` }
  if (!entriesByWorkflow[entry.workflowId]) entriesByWorkflow[entry.workflowId] = []
  entriesByWorkflow[entry.workflowId].push(stored)
  return stored
})

const mockUpdateConsole = vi.fn()
const mockCancelRunningEntries = vi.fn()
const mockClearWorkflowConsole = vi.fn((workflowId: string) => {
  delete entriesByWorkflow[workflowId]
})

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
  reset: resetTerminalConsoleMock,
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
 * Static mock module for `@/stores/terminal` / `@/stores/terminal/console/store`.
 *
 * @example
 * ```ts
 * vi.mock('@/stores/terminal', () => terminalConsoleMock)
 * ```
 */
export const terminalConsoleMock = {
  useTerminalConsoleStore: Object.assign(
    vi.fn(() => stateValue),
    {
      getState: vi.fn(() => stateValue),
      setState: vi.fn(),
      subscribe: vi.fn(),
    }
  ),
  saveExecutionPointer: vi.fn(),
}
