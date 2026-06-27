import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { PresenceState } from '@/stores/presence/types'

/**
 * Live collaborator presence for the active workflow room.
 *
 * Presence is high-frequency (cursor frames arrive many times per second), so it
 * lives in its own store rather than the broad socket context. Only presence
 * consumers (`<Cursors>`, `<Avatars>`) subscribe to it, so cursor frames no
 * longer re-render emitter-only `useSocket()` consumers such as `WorkflowContent`.
 */
export const usePresenceStore = create<PresenceState>()(
  devtools(
    (set) => ({
      presenceUsers: [],
      setPresenceUsers: (users) => set({ presenceUsers: users }),
      updatePresenceUsers: (updater) =>
        set((state) => ({ presenceUsers: updater(state.presenceUsers) })),
      clearPresenceUsers: () => set({ presenceUsers: [] }),
    }),
    { name: 'presence-store' }
  )
)
