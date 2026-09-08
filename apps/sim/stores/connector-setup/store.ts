'use client'

import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import type { ConnectorAccessMode } from '@/lib/knowledge/connectors/access-modes'
import { registerUserDataReset } from '@/stores/user-data-reset-registry'

export interface ConnectorSetupDraft {
  sourceConfig: Record<string, string | string[]>
  canonicalModes: Record<string, 'basic' | 'advanced'>
  accessMode: ConnectorAccessMode
  credentialId: string | null
  contentCredentialId: string | null
  disabledTagIds: string[]
  savedAt: number
}

const MAX_DRAFT_AGE_MS = 30 * 60 * 1000
const MAX_DRAFTS = 10

interface ConnectorSetupState {
  drafts: Record<string, ConnectorSetupDraft>
  saveDraft: (key: string, draft: ConnectorSetupDraft) => void
  clearDraft: (key: string) => void
  getDraft: (key: string) => ConnectorSetupDraft | undefined
  reset: () => void
}

/** Tab-scoped form snapshots survive OAuth; credential secrets and API keys are never stored here. */
export const useConnectorSetupStore = create<ConnectorSetupState>()(
  devtools(
    persist(
      (set, get) => ({
        drafts: {},
        saveDraft: (key, draft) =>
          set((state) => {
            const drafts: Record<string, ConnectorSetupDraft> = {}
            const recent = Object.entries(state.drafts)
              .filter(([id, value]) => id !== key && Date.now() - value.savedAt < MAX_DRAFT_AGE_MS)
              .sort((a, b) => b[1].savedAt - a[1].savedAt)
              .slice(0, MAX_DRAFTS - 1)
            for (const [id, value] of recent) drafts[id] = value
            drafts[key] = draft
            return { drafts }
          }),
        clearDraft: (key) =>
          set((state) => {
            const { [key]: _removed, ...drafts } = state.drafts
            return { drafts }
          }),
        getDraft: (key) => {
          const draft = get().drafts[key]
          return draft && Date.now() - draft.savedAt < MAX_DRAFT_AGE_MS ? draft : undefined
        },
        reset: () => set({ drafts: {} }),
      }),
      {
        name: 'connector-setup-drafts',
        storage: createJSONStorage(() => sessionStorage),
        partialize: (state) => ({ drafts: state.drafts }),
      }
    ),
    { name: 'connector-setup' }
  )
)

registerUserDataReset('connector-setup', () => useConnectorSetupStore.getState().reset())
