import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

/**
 * Phase of a background CSV import as surfaced in the header tray. A completed (`ready`)
 * import is kept briefly so the count can read `1/1`, then auto-cleared by the tracker;
 * `failed` lingers until dismissed.
 */
export type ImportPhase = 'importing' | 'ready' | 'failed'

export interface ImportTrayEntry {
  tableId: string
  workspaceId: string
  /** Table name when known, otherwise the source file name. */
  title: string
  phase: ImportPhase
  rowsProcessed: number
  /** Estimated total rows for a determinate bar; absent until the first progress tick. */
  total?: number
  /** Byte-upload percent (0–100) during the storage-upload phase, before processing starts. */
  uploadPercent?: number
  error?: string
}

/**
 * Partial entry accepted by {@link ImportTrayState.upsert}. `tableId`,
 * `workspaceId`, and `title` identify/create the entry; everything else merges
 * onto whatever is already tracked so a progress tick never clobbers the title.
 */
export type ImportTrayUpsert = Pick<ImportTrayEntry, 'tableId' | 'workspaceId' | 'title'> &
  Partial<Omit<ImportTrayEntry, 'tableId' | 'workspaceId'>>

interface ImportTrayState {
  /** Active + recently-terminal imports, keyed by tableId. */
  entries: Record<string, ImportTrayEntry>
  /**
   * Creates or merges an import entry. Called on mutation kickoff (seeds an
   * `importing` entry so the indicator appears instantly) and on every SSE tick.
   */
  upsert: (entry: ImportTrayUpsert) => void
  /** Removes a single entry (the user dismissed a terminal card). */
  dismiss: (tableId: string) => void
  /** Drops all terminal (`ready` / `failed`) entries for a workspace. */
  clearTerminalFor: (workspaceId: string) => void
  reset: () => void
}

const initialState = { entries: {} as Record<string, ImportTrayEntry> }

export const useImportTrayStore = create<ImportTrayState>()(
  devtools(
    (set) => ({
      ...initialState,

      upsert: (entry) =>
        set((state) => {
          const prev = state.entries[entry.tableId]
          const next: ImportTrayEntry = {
            tableId: entry.tableId,
            workspaceId: entry.workspaceId,
            title: entry.title || prev?.title || 'table',
            phase: entry.phase ?? prev?.phase ?? 'importing',
            rowsProcessed: entry.rowsProcessed ?? prev?.rowsProcessed ?? 0,
            total: entry.total ?? prev?.total,
            uploadPercent: entry.uploadPercent ?? prev?.uploadPercent,
            error: entry.error ?? prev?.error,
          }
          return { entries: { ...state.entries, [entry.tableId]: next } }
        }),

      dismiss: (tableId) =>
        set((state) => {
          if (!state.entries[tableId]) return state
          const { [tableId]: _removed, ...rest } = state.entries
          return { entries: rest }
        }),

      clearTerminalFor: (workspaceId) =>
        set((state) => {
          const rest: Record<string, ImportTrayEntry> = {}
          for (const [id, entry] of Object.entries(state.entries)) {
            if (entry.workspaceId === workspaceId && entry.phase !== 'importing') continue
            rest[id] = entry
          }
          return { entries: rest }
        }),

      reset: () => set(initialState),
    }),
    { name: 'import-tray-store' }
  )
)

/**
 * Entries belonging to a workspace, importing-first so the live ones sort to the
 * top of the dropdown.
 */
export function selectWorkspaceImports(
  state: ImportTrayState,
  workspaceId: string | undefined
): ImportTrayEntry[] {
  if (!workspaceId) return []
  return Object.values(state.entries)
    .filter((e) => e.workspaceId === workspaceId)
    .sort((a, b) => {
      if (a.phase === b.phase) return 0
      return a.phase === 'importing' ? -1 : 1
    })
}
