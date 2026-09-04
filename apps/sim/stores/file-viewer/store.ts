import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface FileViewerState {
  /** Session-only recognition survives partial page streams and viewer remounts. */
  pageFileIds: ReadonlySet<string>
  rememberPage: (fileId: string) => void
  reset: () => void
}

export const useFileViewerStore = create<FileViewerState>()(
  devtools(
    (set) => ({
      pageFileIds: new Set<string>(),
      rememberPage: (fileId) =>
        set((state) => {
          if (state.pageFileIds.has(fileId)) return state
          return { pageFileIds: new Set([...state.pageFileIds, fileId]) }
        }),
      reset: () => set({ pageFileIds: new Set<string>() }),
    }),
    { name: 'file-viewer-store' }
  )
)
