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
          const current = get().byWorkspace[workspaceId]?.resource
          if (
            current &&
            current.type === resource.type &&
            current.id === resource.id &&
            current.title === resource.title
          )
            return
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
