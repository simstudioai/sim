import { toRecord } from '@sim/utils/object'
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { type ModelSelection, ModelSelectionSchema } from '@/lib/mothership/generated/protocol'
import {
  type MothershipEffort,
  resolveMothershipModelSettings,
} from '@/lib/mothership/model-options'

interface MothershipEffortState {
  modelSelection: ModelSelection
  setModel: (model: ModelSelection['model']) => void
  setFastMode: (fastMode: boolean) => void
  /**
   * The effort picked in a composer whose chat does not exist yet. Its first send records
   * it on the new chat; existing chats keep their own choice on the chat itself.
   */
  newChatEffort: MothershipEffort | null
  setNewChatEffort: (effort: MothershipEffort | null) => void
  reset: () => void
}

const initialState = {
  modelSelection: { model: 'gpt-6-astra', fastMode: false },
  newChatEffort: null,
} satisfies Pick<MothershipEffortState, 'modelSelection' | 'newChatEffort'>

function withModelSelection(
  modelSelection: ModelSelection
): Pick<MothershipEffortState, 'modelSelection'> {
  return { modelSelection: resolveMothershipModelSettings({ modelSelection }, true).modelSelection }
}

export const useMothershipEffortStore = create<MothershipEffortState>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,
        setFastMode: (fastMode) =>
          set((state) => withModelSelection({ ...state.modelSelection, fastMode })),
        setModel: (model) =>
          set((state) => withModelSelection({ model, fastMode: state.modelSelection.fastMode })),
        setNewChatEffort: (newChatEffort) => set({ newChatEffort }),
        reset: () => set(initialState),
      }),
      {
        name: 'mothership-effort',
        partialize: ({ modelSelection }) => ({ modelSelection }),
        merge: (persistedState, currentState) => {
          const selection = ModelSelectionSchema.safeParse(toRecord(persistedState).modelSelection)
          return {
            ...currentState,
            ...withModelSelection(selection.success ? selection.data : currentState.modelSelection),
          }
        },
      }
    ),
    { name: 'mothership-effort-store' }
  )
)
