import type { SortDirection } from '@/lib/url-state'

export const RESOURCE_LIST_MODULES = ['files', 'tables', 'knowledge'] as const

export type ResourceListModule = (typeof RESOURCE_LIST_MODULES)[number]

export interface ResourceListPreference {
  sort: {
    column: string
    direction: SortDirection
  }
  filters: Record<string, string[]>
}

export type ResourceListPreferencesByWorkspace = Record<
  string,
  Partial<Record<ResourceListModule, ResourceListPreference>>
>

export interface ResourceListPreferenceConfig {
  module: ResourceListModule
  sortColumns: readonly string[]
  filterKeys: readonly string[]
  defaultPreference: ResourceListPreference
}

export interface ResourceListPreferencesState {
  preferences: ResourceListPreferencesByWorkspace
  _hasHydrated: boolean
  setPreference: (
    workspaceId: string,
    module: ResourceListModule,
    preference: ResourceListPreference
  ) => void
  removePreference: (workspaceId: string, module: ResourceListModule) => void
  reset: () => void
  setHasHydrated: (hasHydrated: boolean) => void
}
