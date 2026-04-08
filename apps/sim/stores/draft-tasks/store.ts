import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { generateShortId } from '@/lib/core/utils/uuid'

interface DraftTaskState {
  /** ID of the current draft task, or null if none exists */
  draftTaskId: string | null
  /** Creates a draft task (reuses existing if one exists). Returns the draft ID. */
  createDraft: () => string
  /** Removes the current draft task */
  removeDraft: () => void
}

export const useDraftTaskStore = create<DraftTaskState>()(
  devtools(
    (set, get) => ({
      draftTaskId: null,

      createDraft: () => {
        const existing = get().draftTaskId
        if (existing) return existing
        const id = `draft-${generateShortId(8)}`
        set({ draftTaskId: id })
        return id
      },

      removeDraft: () => set({ draftTaskId: null }),
    }),
    { name: 'draft-task-store' }
  )
)
