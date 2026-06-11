import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { isEphemeralResource, type MothershipResource } from '@/lib/copilot/resources/types'
import type { MothershipTabsState, WorkspaceTabsState } from './types'

const EMPTY_WORKSPACE_STATE: WorkspaceTabsState = { tabs: [], activeTabId: null }

function tabKey(resource: Pick<MothershipResource, 'type' | 'id'>): string {
  return `${resource.type}:${resource.id}`
}

export const useMothershipTabsStore = create<MothershipTabsState>()(
  devtools(
    persist(
      (set, get) => ({
        byWorkspace: {},
        openTabs: (workspaceId, resources, options) => {
          const additions = resources.filter((resource) => !isEphemeralResource(resource))
          const current = get().byWorkspace[workspaceId] ?? EMPTY_WORKSPACE_STATE
          const existingKeys = new Set(current.tabs.map(tabKey))
          const fresh = additions.filter((resource) => !existingKeys.has(tabKey(resource)))
          const focusId = options?.focusId
          if (fresh.length === 0 && (!focusId || focusId === current.activeTabId)) return
          set((state) => ({
            byWorkspace: {
              ...state.byWorkspace,
              [workspaceId]: {
                tabs: fresh.length > 0 ? [...current.tabs, ...fresh] : current.tabs,
                activeTabId: focusId ?? current.activeTabId,
              },
            },
          }))
        },
        closeTab: (workspaceId, resourceType, resourceId) => {
          const current = get().byWorkspace[workspaceId]
          if (!current) return
          const tabs = current.tabs.filter(
            (tab) => !(tab.type === resourceType && tab.id === resourceId)
          )
          if (tabs.length === current.tabs.length) return
          set((state) => ({
            byWorkspace: {
              ...state.byWorkspace,
              [workspaceId]: {
                tabs,
                activeTabId: current.activeTabId === resourceId ? null : current.activeTabId,
              },
            },
          }))
        },
        reorderTabs: (workspaceId, tabs) => {
          const current = get().byWorkspace[workspaceId] ?? EMPTY_WORKSPACE_STATE
          set((state) => ({
            byWorkspace: {
              ...state.byWorkspace,
              [workspaceId]: {
                tabs: tabs.filter((tab) => !isEphemeralResource(tab)),
                activeTabId: current.activeTabId,
              },
            },
          }))
        },
        setActiveTab: (workspaceId, id) => {
          const current = get().byWorkspace[workspaceId] ?? EMPTY_WORKSPACE_STATE
          if (current.activeTabId === id) return
          set((state) => ({
            byWorkspace: {
              ...state.byWorkspace,
              [workspaceId]: { ...current, activeTabId: id },
            },
          }))
        },
      }),
      {
        name: 'mothership-tabs',
        partialize: (state) => ({ byWorkspace: state.byWorkspace }),
      }
    ),
    { name: 'mothership-tabs-store' }
  )
)
