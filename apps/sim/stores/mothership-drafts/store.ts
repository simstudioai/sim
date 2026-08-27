import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { FileAttachmentForApi } from '@/app/workspace/[workspaceId]/home/types'
import type { ChatContext } from '@/stores/panel'

export interface DraftPayload {
  text: string
  fileAttachments?: FileAttachmentForApi[]
  contexts?: ChatContext[]
}

/**
 * Draft keys are owned by the surface that renders the input, not by this
 * store. Two shapes exist: `<workspaceId>:<chatId|'new'>` for the home chat and
 * `<workspaceId>:workflow-copilot:<workflowId>:<chatId|'new'>` for the workflow
 * panel.
 */
interface MothershipDraftsState {
  drafts: Record<string, DraftPayload>
  setDraft: (key: string, payload: DraftPayload) => void
  clearDraft: (key: string) => void
}

const LEGACY_WORKFLOW_COPILOT_KEY = /^[^:]+:workflow-copilot:[^:]+$/

/**
 * v0 keyed workflow-panel drafts by workflow alone. Those entries are no longer
 * readable by any surface, and nothing prunes a key that is never written
 * again, so drop them once rather than leave them in storage forever. Home
 * drafts are untouched — their key shape did not change.
 */
export function dropLegacyWorkflowCopilotDrafts(persistedState: unknown): {
  drafts: Record<string, DraftPayload>
} {
  const drafts = (persistedState as MothershipDraftsState | null)?.drafts
  if (!drafts) return { drafts: {} }
  const kept: Record<string, DraftPayload> = {}
  for (const [key, payload] of Object.entries(drafts)) {
    if (!LEGACY_WORKFLOW_COPILOT_KEY.test(key)) kept[key] = payload
  }
  return { drafts: kept }
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
        version: 1,
        migrate: (persistedState, version) =>
          (version ?? 0) < 1 ? dropLegacyWorkflowCopilotDrafts(persistedState) : persistedState,
        partialize: (state) => ({ drafts: state.drafts }),
      }
    ),
    { name: 'mothership-drafts-store' }
  )
)
