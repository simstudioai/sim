import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { ModelSelection } from '@/lib/mothership/generated/protocol'

/** The composer's model-effort dial, forwarded per request to the mothership. */
export type MothershipEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const MOTHERSHIP_EFFORT_OPTIONS: Array<{ value: MothershipEffort; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
  { value: 'max', label: 'Max' },
]

export const MOTHERSHIP_MODEL_OPTIONS = [
  { value: 'gpt-6-astra', label: 'GPT-6 Astra' },
  { value: 'claude-opus-5', label: 'Opus 5' },
] satisfies Array<{ value: ModelSelection['model']; label: string }>

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
