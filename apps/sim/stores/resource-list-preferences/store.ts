'use client'

import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import type {
  ResourceListModule,
  ResourceListPreference,
  ResourceListPreferencesByWorkspace,
  ResourceListPreferencesState,
} from '@/stores/resource-list-preferences/types'
import { RESOURCE_LIST_MODULES } from '@/stores/resource-list-preferences/types'
import { resourceListPreferencesEqual } from '@/stores/resource-list-preferences/utils'
import { registerUserDataReset } from '@/stores/user-data-reset-registry'

export const RESOURCE_LIST_PREFERENCES_STORAGE_KEY = 'resource-list-preferences'

const logger = createLogger('ResourceListPreferencesStore')
const RESOURCE_LIST_MODULE_SET = new Set<string>(RESOURCE_LIST_MODULES)

const initialState = {
  preferences: {} as ResourceListPreferencesByWorkspace,
  _hasHydrated: false,
}

/** Keeps device-local preferences best-effort when browser storage is unavailable or full. */
const safeLocalStorage = {
  getItem: (name: string): string | null => {
    try {
      if (typeof localStorage === 'undefined') return null
      return localStorage.getItem(name)
    } catch (error) {
      logger.warn('Failed to read resource list preferences from localStorage', toError(error))
      return null
    }
  },
  setItem: (name: string, value: string): void => {
    try {
      if (typeof localStorage === 'undefined') return
      localStorage.setItem(name, value)
    } catch (error) {
      logger.warn('Failed to persist resource list preferences to localStorage', toError(error))
    }
  },
  removeItem: (name: string): void => {
    try {
      if (typeof localStorage === 'undefined') return
      localStorage.removeItem(name)
    } catch (error) {
      logger.warn('Failed to remove resource list preferences from localStorage', toError(error))
    }
  },
}

function isResourceListModule(value: string): value is ResourceListModule {
  return RESOURCE_LIST_MODULE_SET.has(value)
}

function sanitizePreference(value: unknown): ResourceListPreference | null {
  if (!isRecordLike(value) || !isRecordLike(value.sort) || !isRecordLike(value.filters)) {
    return null
  }

  const { column, direction } = value.sort
  if (
    typeof column !== 'string' ||
    column.length === 0 ||
    (direction !== 'asc' && direction !== 'desc')
  ) {
    return null
  }

  const filters: Record<string, string[]> = {}
  for (const [key, filterValue] of Object.entries(value.filters)) {
    if (!Array.isArray(filterValue) || !filterValue.every((item) => typeof item === 'string')) {
      return null
    }
    filters[key] = [...filterValue]
  }

  return { sort: { column, direction }, filters }
}

function sanitizePreferences(value: unknown): ResourceListPreferencesByWorkspace {
  if (!isRecordLike(value)) return {}

  const preferences: ResourceListPreferencesByWorkspace = {}
  for (const [workspaceId, workspaceValue] of Object.entries(value)) {
    if (workspaceId.length === 0 || !isRecordLike(workspaceValue)) continue

    const workspacePreferences: Partial<Record<ResourceListModule, ResourceListPreference>> = {}
    for (const [module, preferenceValue] of Object.entries(workspaceValue)) {
      if (!isResourceListModule(module)) continue
      const preference = sanitizePreference(preferenceValue)
      if (preference) workspacePreferences[module] = preference
    }

    if (Object.keys(workspacePreferences).length > 0) {
      preferences[workspaceId] = workspacePreferences
    }
  }

  return preferences
}

export const useResourceListPreferencesStore = create<ResourceListPreferencesState>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,
        setPreference: (workspaceId, module, preference) => {
          const currentPreference = get().preferences[workspaceId]?.[module]
          if (currentPreference && resourceListPreferencesEqual(currentPreference, preference)) {
            return
          }
          set((state) => ({
            preferences: {
              ...state.preferences,
              [workspaceId]: {
                ...state.preferences[workspaceId],
                [module]: structuredClone(preference),
              },
            },
          }))
        },
        removePreference: (workspaceId, module) => {
          if (!get().preferences[workspaceId]?.[module]) return
          set((state) => {
            const workspacePreferences = state.preferences[workspaceId] ?? {}
            const nextWorkspacePreferences = { ...workspacePreferences }
            delete nextWorkspacePreferences[module]

            const preferences = { ...state.preferences }
            if (Object.keys(nextWorkspacePreferences).length === 0) {
              delete preferences[workspaceId]
            } else {
              preferences[workspaceId] = nextWorkspacePreferences
            }
            return { preferences }
          })
        },
        reset: () => set({ preferences: {} }),
        setHasHydrated: (_hasHydrated) => set({ _hasHydrated }),
      }),
      {
        name: RESOURCE_LIST_PREFERENCES_STORAGE_KEY,
        storage: createJSONStorage(() => safeLocalStorage),
        version: 1,
        skipHydration: true,
        partialize: (state) => ({ preferences: state.preferences }),
        migrate: () => ({ preferences: {} }),
        merge: (persisted, current) => {
          const persistedState = isRecordLike(persisted) ? persisted : {}
          return {
            ...current,
            preferences: sanitizePreferences(persistedState.preferences),
          }
        },
        onRehydrateStorage: () => (state, error) => {
          if (error) {
            useResourceListPreferencesStore.setState({ preferences: {}, _hasHydrated: true })
            void useResourceListPreferencesStore.persist.clearStorage()
            return
          }
          state?.setHasHydrated(true)
        },
      }
    ),
    { name: 'resource-list-preferences' }
  )
)

registerUserDataReset(RESOURCE_LIST_PREFERENCES_STORAGE_KEY, () => {
  useResourceListPreferencesStore.getState().reset()
  void useResourceListPreferencesStore.persist.clearStorage()
})
