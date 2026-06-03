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
  /** Identifies this specific import run, so replayed SSE events from a prior import of the
   *  same table can be ignored. Known from the kickoff result / the table's `importId`. */
  importId?: string
  phase: ImportPhase
  rowsProcessed: number
  /** Byte-based completion percent (0–100): upload bytes while uploading, processed bytes while
   *  importing. Exact and monotonic — drives the determinate bar. Absent until the first tick. */
  percent?: number
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
  /** Whether the header import dropdown is open (controlled so the start toast can open it). */
  menuOpen: boolean
  /**
   * Creates or merges an import entry. Called on mutation kickoff (seeds an
   * `importing` entry so the indicator appears instantly) and on every SSE tick.
   */
  upsert: (entry: ImportTrayUpsert) => void
  /** Removes a single entry (the user dismissed a terminal card). */
  dismiss: (tableId: string) => void
  /** Drops all terminal (`ready` / `failed`) entries for a workspace. */
  clearTerminalFor: (workspaceId: string) => void
  setMenuOpen: (open: boolean) => void
  reset: () => void
}

const initialState = { entries: {} as Record<string, ImportTrayEntry>, menuOpen: false }

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
            importId: entry.importId ?? prev?.importId,
            phase: entry.phase ?? prev?.phase ?? 'importing',
            rowsProcessed: entry.rowsProcessed ?? prev?.rowsProcessed ?? 0,
            percent: entry.percent ?? prev?.percent,
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

      setMenuOpen: (open) => set({ menuOpen: open }),

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
