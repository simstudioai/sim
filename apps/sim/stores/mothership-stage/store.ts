import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { isEphemeralResource } from '@/lib/copilot/resources/types'
import type { MothershipStageState } from './types'

/** How many recently staged resources the empty state keeps per workspace. */
const RECENTS_LIMIT = 8

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
          set((state) => {
            const current = state.byWorkspace[workspaceId]
            const recents = [
              resource,
              ...(current?.recents ?? []).filter(
                (r) => !(r.type === resource.type && r.id === resource.id)
              ),
            ].slice(0, RECENTS_LIMIT)
            return {
              byWorkspace: {
                ...state.byWorkspace,
                [workspaceId]: { resource, recents },
              },
            }
          })
        },
        clearStage: (workspaceId) => {
          const current = get().byWorkspace[workspaceId]
          if (!current?.resource) return
          set((state) => ({
            byWorkspace: {
              ...state.byWorkspace,
              [workspaceId]: { resource: null, recents: current.recents ?? [] },
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
