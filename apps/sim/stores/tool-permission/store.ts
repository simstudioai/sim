import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

/**
 * Tracks which tool calls are currently sitting on a permission prompt.
 *
 * The cards themselves are rendered independently down the message tree, so
 * they need somewhere shared to see each other: that is what makes an
 * "Allow all" affordance possible when a turn gates several tools at once, and
 * what stops every card from rendering its own copy of that affordance.
 *
 * Decisions are recorded here too, so a card stays settled during the round
 * trip rather than flickering back to actionable before the stream catches up.
 */
interface ToolPermissionState {
  /** Awaiting tool call ids, in the order their cards mounted. */
  awaitingIds: string[]
  /** Ids with an answer already sent, cleared when the card unmounts. */
  submittedIds: string[]
  register: (toolCallId: string) => void
  unregister: (toolCallId: string) => void
  markSubmitted: (toolCallIds: string[]) => void
  clearSubmitted: (toolCallIds: string[]) => void
  reset: () => void
}

const initialState = {
  awaitingIds: [] as string[],
  submittedIds: [] as string[],
}

export const useToolPermissionStore = create<ToolPermissionState>()(
  devtools(
    (set) => ({
      ...initialState,
      register: (toolCallId) =>
        set((state) =>
          state.awaitingIds.includes(toolCallId)
            ? {}
            : { awaitingIds: [...state.awaitingIds, toolCallId] }
        ),
      unregister: (toolCallId) =>
        set((state) => ({
          awaitingIds: state.awaitingIds.filter((id) => id !== toolCallId),
          submittedIds: state.submittedIds.filter((id) => id !== toolCallId),
        })),
      markSubmitted: (toolCallIds) =>
        set((state) => {
          const next = toolCallIds.filter((id) => !state.submittedIds.includes(id))
          return next.length === 0 ? {} : { submittedIds: [...state.submittedIds, ...next] }
        }),
      clearSubmitted: (toolCallIds) =>
        set((state) => ({
          submittedIds: state.submittedIds.filter((id) => !toolCallIds.includes(id)),
        })),
      reset: () => set({ ...initialState }),
    }),
    { name: 'tool-permission-store' }
  )
)
