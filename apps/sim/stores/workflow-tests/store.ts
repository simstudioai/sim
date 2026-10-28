import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

/**
 * Which run each open test shows. The run picker and the results it controls render in
 * different places (the page header and its preview, or a chat tab's actions and its
 * content), so the choice lives here. A missing entry means the latest run.
 */
interface TestRunSelectionState {
  selectedRunIds: Record<string, string>
  /** Tests whose open editor holds edits the server has not saved; Run waits for them. */
  unsavedTests: Record<string, true>
  selectRun: (testKey: string, runId: string | null) => void
  setUnsaved: (testKey: string, unsaved: boolean) => void
  reset: () => void
}

export const useTestRunSelectionStore = create<TestRunSelectionState>()(
  devtools(
    (set) => ({
      selectedRunIds: {},
      unsavedTests: {},
      selectRun: (testKey, runId) =>
        set((state) => {
          const { [testKey]: _previous, ...rest } = state.selectedRunIds
          return { selectedRunIds: runId === null ? rest : { ...rest, [testKey]: runId } }
        }),
      setUnsaved: (testKey, unsaved) =>
        set((state) => {
          const { [testKey]: _previous, ...rest } = state.unsavedTests
          return { unsavedTests: unsaved ? { ...rest, [testKey]: true } : rest }
        }),
      reset: () => set({ selectedRunIds: {}, unsavedTests: {} }),
    }),
    { name: 'test-run-selection' }
  )
)

export function testRunSelectionKey(workspaceId: string, name: string): string {
  return `${workspaceId}:${name}`
}
