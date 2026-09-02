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

  it('removes one preference without disturbing sibling entries', () => {
    const store = useResourceListPreferencesStore.getState()
    store.setPreference('workspace-1', 'files', filesPreference)
    store.setPreference('workspace-1', 'tables', tablesPreference)

    store.removePreference('workspace-1', 'files')

    expect(useResourceListPreferencesStore.getState().preferences).toEqual({
      'workspace-1': { tables: tablesPreference },
    })
  })

  it('persists only the preference map', () => {
    useResourceListPreferencesStore
      .getState()
      .setPreference('workspace-1', 'files', filesPreference)

    expect(persistedValue()).toEqual({
      state: { preferences: { 'workspace-1': { files: filesPreference } } },
      version: 1,
    })
  })

  it('does not publish a redundant state update for an unchanged preference', () => {
    const store = useResourceListPreferencesStore.getState()
    store.setPreference('workspace-1', 'files', filesPreference)
    const stateAfterFirstWrite = useResourceListPreferencesStore.getState()

    store.setPreference('workspace-1', 'files', structuredClone(filesPreference))

    expect(useResourceListPreferencesStore.getState()).toBe(stateAfterFirstWrite)
  })

  it('hydrates a valid saved preference and marks hydration complete', async () => {
    localStorage.setItem(
      RESOURCE_LIST_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        state: { preferences: { 'workspace-1': { files: filesPreference } } },
        version: 1,
      })
    )

    await useResourceListPreferencesStore.persist.rehydrate()

    expect(useResourceListPreferencesStore.getState()).toMatchObject({
      preferences: { 'workspace-1': { files: filesPreference } },
      _hasHydrated: true,
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

  it('recovers from invalid JSON with an empty hydrated store', async () => {
    localStorage.setItem(RESOURCE_LIST_PREFERENCES_STORAGE_KEY, '{not-json')

    await useResourceListPreferencesStore.persist.rehydrate()

    expect(useResourceListPreferencesStore.getState()).toMatchObject({
      preferences: {},
      _hasHydrated: true,
    })
    expect(localStorage.getItem(RESOURCE_LIST_PREFERENCES_STORAGE_KEY)).toBeNull()
  })

  it('hydrates an empty store when localStorage reads throw', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage is blocked', 'SecurityError')
    })

    await expect(useResourceListPreferencesStore.persist.rehydrate()).resolves.toBeUndefined()

    expect(useResourceListPreferencesStore.getState()).toMatchObject({
      preferences: {},
      _hasHydrated: true,
    })
  })

  it('keeps in-memory preferences when localStorage writes throw', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is full', 'QuotaExceededError')
    })

    expect(() =>
      useResourceListPreferencesStore
        .getState()
        .setPreference('workspace-1', 'files', filesPreference)
    ).not.toThrow()
    expect(useResourceListPreferencesStore.getState().preferences).toEqual({
      'workspace-1': { files: filesPreference },
    })
  })

  it('completes malformed-state recovery when localStorage removal throws', async () => {
    localStorage.setItem(RESOURCE_LIST_PREFERENCES_STORAGE_KEY, '{not-json')
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage is blocked', 'SecurityError')
    })

    await expect(useResourceListPreferencesStore.persist.rehydrate()).resolves.toBeUndefined()

    expect(useResourceListPreferencesStore.getState()).toMatchObject({
      preferences: {},
      _hasHydrated: true,
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
