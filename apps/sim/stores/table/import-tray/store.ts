import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

/**
 * An in-flight client upload, shown optimistically before its server import row exists or the
 * table list has refreshed. Keyed by `uploadId`: a `pending_*` id (creating a new table, no row
 * yet) or the target tableId (append/replace into an existing table).
 */
export interface ImportUpload {
  uploadId: string
  workspaceId: string
  title: string
  /** Byte-based upload percent from the client XHR. */
  percent?: number
}

/**
 * Client-only state for the import tray. The importing/terminal rows themselves are derived from
 * the table list (React Query) — this store holds only what the server doesn't: optimistic uploads,
 * which terminal completions to surface this session, canceled ids, and the menu's open state.
 */
interface ImportTrayState {
  uploads: Record<string, ImportUpload>
  /** Terminal (`ready`/`failed`) table ids to surface as a card this session. */
  notified: Record<string, true>
  /** Ids (upload or table) canceled so callbacks/derivation don't resurrect them. */
  canceledIds: Record<string, true>
  menuOpen: boolean

  startUpload: (upload: ImportUpload) => void
  setUploadPercent: (uploadId: string, percent: number) => void
  endUpload: (uploadId: string) => void
  /** Surface a terminal completion as a tray card. */
  notify: (tableId: string) => void
  /** Remove a terminal card (manual dismiss or auto-clear). */
  dismiss: (tableId: string) => void
  /** Flag an id canceled and drop any optimistic upload for it. */
  cancel: (id: string) => void
  isCanceled: (id: string) => boolean
  /** Returns whether the id was canceled and clears the flag (one-shot, for the kickoff handler). */
  consumeCanceled: (id: string) => boolean
  setMenuOpen: (open: boolean) => void
  reset: () => void
}

const initialState = {
  uploads: {} as Record<string, ImportUpload>,
  notified: {} as Record<string, true>,
  canceledIds: {} as Record<string, true>,
  menuOpen: false,
}

export const useImportTrayStore = create<ImportTrayState>()(
  devtools(
    (set, get) => ({
      ...initialState,

      startUpload: (upload) =>
        set((state) => ({ uploads: { ...state.uploads, [upload.uploadId]: upload } })),

      setUploadPercent: (uploadId, percent) =>
        set((state) => {
          const prev = state.uploads[uploadId]
          if (!prev) return state
          return { uploads: { ...state.uploads, [uploadId]: { ...prev, percent } } }
        }),

      endUpload: (uploadId) =>
        set((state) => {
          if (!state.uploads[uploadId]) return state
          const { [uploadId]: _removed, ...rest } = state.uploads
          return { uploads: rest }
        }),

      notify: (tableId) => set((state) => ({ notified: { ...state.notified, [tableId]: true } })),

      dismiss: (tableId) =>
        set((state) => {
          if (!state.notified[tableId]) return state
          const { [tableId]: _removed, ...rest } = state.notified
          return { notified: rest }
        }),

      cancel: (id) =>
        set((state) => {
          const { [id]: _removed, ...uploads } = state.uploads
          return { uploads, canceledIds: { ...state.canceledIds, [id]: true } }
        }),

      isCanceled: (id) => Boolean(get().canceledIds[id]),

      consumeCanceled: (id) => {
        const was = Boolean(get().canceledIds[id])
        if (was) {
          set((state) => {
            const { [id]: _removed, ...rest } = state.canceledIds
            return { canceledIds: rest }
          })
        }
        return was
      },

      setMenuOpen: (open) => set({ menuOpen: open }),

      reset: () => set(initialState),
    }),
    { name: 'import-tray-store' }
  )
)
