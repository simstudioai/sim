import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

/**
 * Which run each open test shows. The run picker and the results it controls render in
 * different places (the page header and its preview, or a chat tab's actions and its
 * content), so the choice lives here. A missing entry means the latest run.
 */
interface TestRunSelectionState {
  selectedRunIds: Record<string, string>
  selectRun: (testKey: string, runId: string | null) => void
  reset: () => void
}

export const useTestRunSelectionStore = create<TestRunSelectionState>()(
  devtools(
    (set) => ({
      selectedRunIds: {},
      selectRun: (testKey, runId) =>
        set((state) => {
          const { [testKey]: _previous, ...rest } = state.selectedRunIds
          return { selectedRunIds: runId === null ? rest : { ...rest, [testKey]: runId } }
        }),
      reset: () => set({ selectedRunIds: {} }),
    }),
    { name: 'test-run-selection' }
  )
)

export function testRunSelectionKey(workspaceId: string, name: string): string {
  return `${workspaceId}:${name}`
}
