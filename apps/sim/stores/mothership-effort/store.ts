import { toRecord } from '@sim/utils/object'
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { type ModelSelection, ModelSelectionSchema } from '@/lib/mothership/generated/protocol'
import {
  MOTHERSHIP_EFFORT_OPTIONS,
  type MothershipEffort,
  resolveMothershipModelSettings,
} from '@/lib/mothership/model-options'

interface MothershipEffortState {
  modelSelection: ModelSelection
  setModel: (model: ModelSelection['model']) => void
  setFastMode: (fastMode: boolean) => void
  effort: MothershipEffort
  setEffort: (effort: MothershipEffort) => void
  reset: () => void
}

function createMothershipEffortStore(plan: boolean) {
  const initialState = resolveMothershipModelSettings({}, true, plan)
  const name = plan ? 'mothership-plan-effort' : 'mothership-effort'
  return create<MothershipEffortState>()(
    devtools(
      persist(
        (set) => ({
          ...initialState,
          setFastMode: (fastMode) =>
            set((state) =>
              resolveMothershipModelSettings(
                { ...state, modelSelection: { ...state.modelSelection, fastMode } },
                true,
                plan
              )
            ),
          setModel: (model) =>
            set((state) =>
              resolveMothershipModelSettings(
                { ...state, modelSelection: { model, fastMode: state.modelSelection.fastMode } },
                true,
                plan
              )
            ),
          setEffort: (effort) => set({ effort }),
          reset: () => set(initialState),
        }),
        {
          name,
          partialize: ({ effort, modelSelection }) => ({ effort, modelSelection }),
          merge: (persistedState, currentState) => {
            const persisted = toRecord(persistedState)
            const selection = ModelSelectionSchema.safeParse(persisted.modelSelection)
            const effort =
              persisted.effort === 'none'
                ? 'none'
                : (MOTHERSHIP_EFFORT_OPTIONS.find((option) => option.value === persisted.effort)
                    ?.value ?? currentState.effort)
            return {
              ...currentState,
              ...resolveMothershipModelSettings(
                {
                  effort,
                  modelSelection: selection.success ? selection.data : currentState.modelSelection,
                },
                true,
                plan
              ),
            }
          },
        }
      ),
      { name: `${name}-store` }
    )
  )
}

export const useMothershipEffortStore = createMothershipEffortStore(false)
export const useMothershipPlanEffortStore = createMothershipEffortStore(true)
