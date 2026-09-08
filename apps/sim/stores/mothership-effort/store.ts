import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { ModelSelection } from '@/lib/mothership/generated/protocol'
import type { MothershipEffort } from '@/lib/mothership/model-options'

interface MothershipEffortState {
  modelSelection: ModelSelection
  setModel: (model: ModelSelection['model']) => void
  setFastMode: (fastMode: boolean) => void
  effort: MothershipEffort
  setEffort: (effort: MothershipEffort) => void
}

export const useMothershipEffortStore = create<MothershipEffortState>()(
  devtools(
    persist(
      (set) => ({
        effort: 'high',
        modelSelection: { model: 'gpt-6-astra', fastMode: false },
        setModel: (model) =>
          set((state) => ({
            modelSelection: {
              model,
              fastMode: model === 'gpt-6-astra' && state.modelSelection.fastMode,
            },
          })),
        setFastMode: (fastMode) =>
          set((state) => ({
            modelSelection: {
              ...state.modelSelection,
              fastMode: state.modelSelection.model === 'gpt-6-astra' && fastMode,
            },
          })),
        setEffort: (effort) => set({ effort }),
      }),
      {
        name: 'mothership-effort',
        partialize: ({ effort, modelSelection }) => ({ effort, modelSelection }),
      }
    ),
    { name: 'mothership-effort-store' }
  )
)
