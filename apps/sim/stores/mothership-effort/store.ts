import { toRecord } from '@sim/utils/object'
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { ModelSelection } from '@/lib/mothership/generated/protocol'
import { MOTHERSHIP_EFFORT_OPTIONS, type MothershipEffort } from '@/lib/mothership/model-options'

interface MothershipEffortState {
  modelSelection: ModelSelection & { model: 'gpt-6-astra' }
  setFastMode: (fastMode: boolean) => void
  effort: MothershipEffort
  setEffort: (effort: MothershipEffort) => void
  reset: () => void
}

const initialState = {
  effort: 'high',
  modelSelection: { model: 'gpt-6-astra', fastMode: false },
} satisfies Pick<MothershipEffortState, 'effort' | 'modelSelection'>

export const useMothershipEffortStore = create<MothershipEffortState>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,
        setFastMode: (fastMode) => set({ modelSelection: { model: 'gpt-6-astra', fastMode } }),
        setEffort: (effort) => set({ effort }),
        reset: () => set(initialState),
      }),
      {
        name: 'mothership-effort',
        partialize: ({ effort, modelSelection }) => ({ effort, modelSelection }),
        merge: (persistedState, currentState) => {
          const persisted = toRecord(persistedState)
          const selection = toRecord(persisted.modelSelection)
          return {
            ...currentState,
            effort:
              MOTHERSHIP_EFFORT_OPTIONS.find((option) => option.value === persisted.effort)
                ?.value ?? currentState.effort,
            modelSelection: {
              model: 'gpt-6-astra',
              fastMode:
                typeof selection.fastMode === 'boolean'
                  ? selection.fastMode
                  : currentState.modelSelection.fastMode,
            },
          }
        },
      }
    ),
    { name: 'mothership-effort-store' }
  )
)
