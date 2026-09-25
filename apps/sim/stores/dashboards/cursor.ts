import { devtools } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'

interface DashboardCursor {
  owner: string
  group: string
  time: number
}
interface DashboardCursorState {
  cursor: DashboardCursor | null
  setCursor: (cursor: DashboardCursor) => void
  clearCursor: (owner?: string) => void
}

/** Each mounted dashboard owns its cursor; hover never becomes URL or server state. */
export function createDashboardCursorStore() {
  return createStore<DashboardCursorState>()(
    devtools(
      (set) => ({
        cursor: null,
        setCursor: (cursor) =>
          set((state) =>
            state.cursor?.owner === cursor.owner &&
            state.cursor?.group === cursor.group &&
            state.cursor?.time === cursor.time
              ? state
              : { cursor }
          ),
        clearCursor: (owner) =>
          set((state) =>
            owner === undefined || state.cursor?.owner === owner ? { cursor: null } : state
          ),
      }),
      { name: 'dashboard-cursor' }
    )
  )
}
export type DashboardCursorStore = ReturnType<typeof createDashboardCursorStore>
