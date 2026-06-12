import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { isEphemeralResource } from '@/lib/copilot/resources/types'
import type { MothershipStageState } from './types'

export const useMothershipStageStore = create<MothershipStageState>()(
  devtools(
    persist(
      (set, get) => ({
        byWorkspace: {},
        setStage: (workspaceId, resource) => {
          if (isEphemeralResource(resource)) return
          // Always a fresh object, even for the already-staged resource:
          // re-staging is a "surface this" signal, and the panel's expand
          // effect keys on the staged resource's identity.
          set((state) => ({
            byWorkspace: {
              ...state.byWorkspace,
              [workspaceId]: { resource },
            },
          }))
        },
        clearStage: (workspaceId) => {
          if (!get().byWorkspace[workspaceId]?.resource) return
          set((state) => ({
            byWorkspace: {
              ...state.byWorkspace,
              [workspaceId]: { resource: null },
            },
          }))
        },
      }),
      {
        name: 'mothership-stage',
        partialize: (state) => ({ byWorkspace: state.byWorkspace }),
      }
    ),
    { name: 'mothership-stage-store' }
  )
)
