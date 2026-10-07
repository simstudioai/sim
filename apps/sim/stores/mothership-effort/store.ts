import { omit, toRecord } from '@sim/utils/object'
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { type ModelSelection, ModelSelectionSchema } from '@/lib/mothership/generated/protocol'
import { type MothershipEffort, normalizeModelSelection } from '@/lib/mothership/model-options'

/** A chat's effort pick and the token that tells it apart from other picks of the same value. */
interface ChatEffortPick {
  effort: MothershipEffort
  pick: number
}

interface MothershipEffortState {
  modelSelection: ModelSelection
  setModel: (model: ModelSelection['model']) => void
  setFastMode: (fastMode: boolean) => void
  /**
   * The effort picked in a composer whose chat does not exist yet. Its first send records
   * it on the new chat; leaving that composer unsent drops it.
   */
  newChatEffort: MothershipEffort | null
  setNewChatEffort: (effort: MothershipEffort | null) => void
  /**
   * Picks made in existing chats this session, by chat id. They win over the chat's loaded
   * value, so a detail refetch or a save still in flight never shows or sends an older one.
   */
  chatEfforts: Record<string, ChatEffortPick>
  /** Records a pick and returns its token for {@link MothershipEffortState.dropChatEffort}. */
  setChatEffort: (chatId: string, effort: MothershipEffort) => number
  /** Drops a pick whose save failed, unless a newer pick replaced it, even one of the same value. */
  dropChatEffort: (chatId: string, pick: number) => void
  /** Moves the new-chat pick onto the chat its first send created. */
  adoptNewChatEffort: (chatId: string, effort: MothershipEffort) => void
  reset: () => void
}

const initialState: Pick<
  MothershipEffortState,
  'modelSelection' | 'newChatEffort' | 'chatEfforts'
> = {
  modelSelection: { model: 'gpt-6-astra', fastMode: false },
  newChatEffort: null,
  chatEfforts: {},
}

/** Counts picks across chats so a token never repeats within a session. */
let lastChatEffortPick = 0

function withModelSelection(
  modelSelection: ModelSelection
): Pick<MothershipEffortState, 'modelSelection'> {
  return { modelSelection: normalizeModelSelection(modelSelection) }
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
        setChatEffort: (chatId, effort) => {
          const pick = ++lastChatEffortPick
          set((state) => ({ chatEfforts: { ...state.chatEfforts, [chatId]: { effort, pick } } }))
          return pick
        },
        dropChatEffort: (chatId, pick) =>
          set((state) => {
            if (state.chatEfforts[chatId]?.pick !== pick) return state
            return { chatEfforts: omit(state.chatEfforts, [chatId]) }
          }),
        adoptNewChatEffort: (chatId, effort) => {
          const pick = ++lastChatEffortPick
          set((state) => ({
            newChatEffort: null,
            chatEfforts: { ...state.chatEfforts, [chatId]: { effort, pick } },
          }))
        },
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
