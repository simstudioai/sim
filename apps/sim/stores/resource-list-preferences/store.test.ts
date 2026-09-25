/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RESOURCE_LIST_PREFERENCES_STORAGE_KEY,
  useResourceListPreferencesStore,
} from '@/stores/resource-list-preferences'
import { resetRegisteredUserData } from '@/stores/user-data-reset-registry'

const filesPreference = {
  sort: { column: 'name', direction: 'asc' as const },
  filters: { type: ['document'], size: [], uploadedBy: ['user-1'] },
}

const tablesPreference = {
  sort: { column: 'rows', direction: 'desc' as const },
  filters: { rows: ['large'], owner: [] },
}

function persistedValue() {
  const value = localStorage.getItem(RESOURCE_LIST_PREFERENCES_STORAGE_KEY)
  return value ? JSON.parse(value) : null
}

describe('resource list preferences store', () => {
  beforeEach(() => {
    localStorage.clear()
    useResourceListPreferencesStore.setState({ preferences: {}, _hasHydrated: false })
    void useResourceListPreferencesStore.persist.clearStorage()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps preferences independent by workspace and module', () => {
    const store = useResourceListPreferencesStore.getState()

    store.setPreference('workspace-1', 'files', filesPreference)
    store.setPreference('workspace-1', 'tables', tablesPreference)
    store.setPreference('workspace-2', 'files', {
      ...filesPreference,
      filters: { ...filesPreference.filters, uploadedBy: ['user-2'] },
    })

    expect(useResourceListPreferencesStore.getState().preferences).toEqual({
      'workspace-1': { files: filesPreference, tables: tablesPreference },
      'workspace-2': {
        files: {
          ...filesPreference,
          filters: { ...filesPreference.filters, uploadedBy: ['user-2'] },
        },
      },
    })
  })

  it('drops malformed persisted entries while preserving valid siblings', async () => {
    localStorage.setItem(
      RESOURCE_LIST_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        state: {
          preferences: {
            'workspace-1': {
              files: { sort: { column: 42, direction: 'up' }, filters: [] },
              tables: tablesPreference,
            },
          },
        },
        version: 1,
      })
    )

    await useResourceListPreferencesStore.persist.rehydrate()

    expect(useResourceListPreferencesStore.getState().preferences).toEqual({
      'workspace-1': { tables: tablesPreference },
    })
  })

  it.each([0, 2])('discards preferences from incompatible storage version %i', async (version) => {
    localStorage.setItem(
      RESOURCE_LIST_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        state: { preferences: { 'workspace-1': { files: filesPreference } } },
        version,
      })
    )

    await useResourceListPreferencesStore.persist.rehydrate()

    expect(useResourceListPreferencesStore.getState().preferences).toEqual({})
    expect(persistedValue()).toEqual({ state: { preferences: {} }, version: 1 })
  })

  it('clears in-memory and persisted identity-scoped values on user reset', () => {
    useResourceListPreferencesStore
      .getState()
      .setPreference('workspace-1', 'files', filesPreference)

    resetRegisteredUserData()

    expect(useResourceListPreferencesStore.getState().preferences).toEqual({})
    expect(localStorage.getItem(RESOURCE_LIST_PREFERENCES_STORAGE_KEY)).toBeNull()
  })
})
