import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { FileAttachmentForApi } from '@/app/workspace/[workspaceId]/home/types'
import type { ChatContext } from '@/stores/panel'

export interface DraftPayload {
  text: string
  fileAttachments?: FileAttachmentForApi[]
  contexts?: ChatContext[]
}

interface MothershipDraftsState {
  drafts: Record<string, DraftPayload>
  setDraft: (key: string, payload: DraftPayload) => void
  clearDraft: (key: string) => void
}

function isEmpty(payload: DraftPayload): boolean {
  return !payload.text && !payload.fileAttachments?.length && !payload.contexts?.length
}

export const useMothershipDraftsStore = create<MothershipDraftsState>()(
  devtools(
    persist(
      (set) => ({
        drafts: {},
        setDraft: (key, payload) =>
          set((s) => {
            if (isEmpty(payload)) {
              if (!(key in s.drafts)) return s
              const { [key]: _, ...rest } = s.drafts
              return { drafts: rest }
            }
            return { drafts: { ...s.drafts, [key]: payload } }
          }),
        clearDraft: (key) =>
          set((s) => {
            if (!(key in s.drafts)) return s
            const { [key]: _, ...rest } = s.drafts
            return { drafts: rest }
          }),
      }),
      {
        name: 'mothership-drafts:v1',
        partialize: (state) => ({ drafts: state.drafts }),
      }
    ),
    { name: 'mothership-drafts-store' }
  )
)
