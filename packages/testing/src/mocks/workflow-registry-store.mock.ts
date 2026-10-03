import { vi } from 'vitest'

type Listener = (state: Record<string, unknown>, previous: Record<string, unknown>) => void

/** The real initial data slice of `useWorkflowRegistry` (hydration `idle`, nothing active). */
function createInitialWorkflowRegistryState(): Record<string, unknown> {
  return {
    activeWorkflowId: null,
    error: null,
    hydration: {
      phase: 'idle',
      workspaceId: null,
      workflowId: null,
      requestId: null,
      error: null,
    },
    clipboard: null,
    pendingSelection: null,
  }
}

/**
 * Controllable mock functions for `@/stores/workflows/registry/store`.
 *
 * `useWorkflowRegistry` is a zustand-shaped stand-in over one mutable state object: calling it
 * applies the selector to the current state, and `getState`/`setState`/`subscribe` behave like
 * zustand (`setState` shallow-merges a partial or updater result and notifies subscribers).
 * The state starts from the real initial data slice plus the actions below.
 *
 * Action defaults: `mockSetActiveWorkflow`/`mockLoadWorkflowState` resolve `undefined`,
 * `mockPreparePasteData` returns `null`, `mockHasClipboard` returns `false`, the rest are no-ops.
 * Call {@link resetWorkflowRegistryMockState} (e.g. in `beforeEach`) to restore the initial state
 * after a test called `setState`.
 *
 * @example
 * ```ts
 * import { workflowRegistryStoreMockFns } from '@sim/testing/mocks/workflow-registry-store.mock'
 *
 * workflowRegistryStoreMockFns.mockSetState({ activeWorkflowId: 'wf-1' })
 * workflowRegistryStoreMockFns.mockGetState.mockReturnValue({ activeWorkflowId: null })
 * ```
 */
export const workflowRegistryStoreMockFns = {
  mockSetActiveWorkflow: vi.fn(async (_id: string): Promise<void> => {}),
  mockLoadWorkflowState: vi.fn(async (_workflowId: string): Promise<void> => {}),
  mockSwitchToWorkspace: vi.fn((_id: string): void => {}),
  mockMarkWorkflowCreating: vi.fn((_workflowId: string): void => {}),
  mockMarkWorkflowCreated: vi.fn((_workflowId: string | null): void => {}),
  mockCopyBlocks: vi.fn((_blockIds: string[]): void => {}),
  mockPreparePasteData: vi.fn((_positionOffset?: { x: number; y: number }): unknown => null),
  mockHasClipboard: vi.fn((): boolean => false),
  mockClearClipboard: vi.fn((): void => {}),
  mockSetPendingSelection: vi.fn((_blockIds: string[]): void => {}),
  mockClearPendingSelection: vi.fn((): void => {}),
  mockLogout: vi.fn((): void => {}),
  mockUseWorkflowRegistry: vi.fn(
    (selector?: (state: Record<string, unknown>) => unknown): unknown =>
      selector ? selector(registryState) : registryState
  ),
  mockGetState: vi.fn((): Record<string, unknown> => registryState),
  mockSetState: vi.fn(
    (
      partial:
        | Record<string, unknown>
        | ((state: Record<string, unknown>) => Record<string, unknown>),
      replace?: boolean
    ): void => {
      const previous = registryState
      const next = typeof partial === 'function' ? partial(registryState) : partial
      registryState = replace ? next : { ...registryState, ...next }
      for (const listener of listeners) listener(registryState, previous)
    }
  ),
  mockSubscribe: vi.fn((listener: Listener): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }),
}

function createRegistryState(): Record<string, unknown> {
  const fns = workflowRegistryStoreMockFns
  return {
    ...createInitialWorkflowRegistryState(),
    setActiveWorkflow: fns.mockSetActiveWorkflow,
    loadWorkflowState: fns.mockLoadWorkflowState,
    switchToWorkspace: fns.mockSwitchToWorkspace,
    markWorkflowCreating: fns.mockMarkWorkflowCreating,
    markWorkflowCreated: fns.mockMarkWorkflowCreated,
    copyBlocks: fns.mockCopyBlocks,
    preparePasteData: fns.mockPreparePasteData,
    hasClipboard: fns.mockHasClipboard,
    clearClipboard: fns.mockClearClipboard,
    setPendingSelection: fns.mockSetPendingSelection,
    clearPendingSelection: fns.mockClearPendingSelection,
    logout: fns.mockLogout,
  }
}

const listeners = new Set<Listener>()
let registryState: Record<string, unknown> = createRegistryState()

/**
 * Restores the mocked registry to its initial state (optionally merged with `overrides`) and
 * drops every subscriber. Does not touch the `vi.fn()` call history.
 */
export function resetWorkflowRegistryMockState(overrides: Record<string, unknown> = {}): void {
  registryState = { ...createRegistryState(), ...overrides }
  listeners.clear()
}

/**
 * Static mock module for `@/stores/workflows/registry/store`. `useWorkflowRegistry` is the
 * callable selector hook with `getState`/`setState`/`subscribe` attached.
 *
 * @example
 * ```ts
 * vi.mock('@/stores/workflows/registry/store', () => workflowRegistryStoreMock)
 * ```
 */
export const workflowRegistryStoreMock = {
  useWorkflowRegistry: Object.assign(workflowRegistryStoreMockFns.mockUseWorkflowRegistry, {
    getState: workflowRegistryStoreMockFns.mockGetState,
    setState: workflowRegistryStoreMockFns.mockSetState,
    subscribe: workflowRegistryStoreMockFns.mockSubscribe,
  }),
}
