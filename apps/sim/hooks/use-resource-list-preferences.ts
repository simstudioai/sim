'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseAsString, useQueryStates } from 'nuqs'
import type {
  ResourceListPreference,
  ResourceListPreferenceConfig,
} from '@/stores/resource-list-preferences'
import { useResourceListPreferencesStore } from '@/stores/resource-list-preferences'
import { resourceListPreferencesEqual } from '@/stores/resource-list-preferences/utils'

interface UseResourceListPreferencesProps {
  workspaceId: string
  config: ResourceListPreferenceConfig
  preference: ResourceListPreference
  applyPreference: (preference: ResourceListPreference) => unknown
  enabled?: boolean
}

interface UseResourceListPreferencesReturn {
  isReady: boolean
  setFilter: (filterKey: string, values: string[]) => void
  clearFilters: () => void
  setSort: (column: string, direction: ResourceListPreference['sort']['direction']) => void
  clearSort: () => void
}

interface PendingRestoration {
  key: string
  preference: ResourceListPreference
}

function normalizePreference(
  preference: ResourceListPreference | undefined,
  config: ResourceListPreferenceConfig
): ResourceListPreference | null {
  if (
    !preference ||
    !config.sortColumns.includes(preference.sort.column) ||
    (preference.sort.direction !== 'asc' && preference.sort.direction !== 'desc')
  ) {
    return null
  }

  const filterKeys = Object.keys(preference.filters)
  if (
    filterKeys.length !== config.filterKeys.length ||
    !config.filterKeys.every((key) => filterKeys.includes(key))
  ) {
    return null
  }

  for (const key of config.filterKeys) {
    const values = preference.filters[key]
    if (!Array.isArray(values) || !values.every((value) => typeof value === 'string')) return null
  }

  return {
    sort: { ...preference.sort },
    filters: Object.fromEntries(
      config.filterKeys.map((key) => [key, [...preference.filters[key]]])
    ),
  }
}

/**
 * Reconciles a module's URL-owned list state with its last-used local preference.
 * Zustand is read only during initial entry and explicit user commits; it never
 * becomes a live mirror of URL changes or browser history navigation.
 */
export function useResourceListPreferences({
  workspaceId,
  config,
  preference,
  applyPreference,
  enabled = true,
}: UseResourceListPreferencesProps): UseResourceListPreferencesReturn {
  const key = `${workspaceId}:${config.module}`
  const initializedKeyRef = useRef<string | null>(null)
  const hydrationRequestedRef = useRef(false)
  const [readyKey, setReadyKey] = useState<string | null>(null)
  const [pendingRestoration, setPendingRestoration] = useState<PendingRestoration | null>(null)
  const hasHydrated = useResourceListPreferencesStore((state) => state._hasHydrated)
  const savedPreference = useResourceListPreferencesStore(
    (state) => state.preferences[workspaceId]?.[config.module]
  )
  const setPreference = useResourceListPreferencesStore((state) => state.setPreference)
  const removePreference = useResourceListPreferencesStore((state) => state.removePreference)
  const preferenceQueryParsers = Object.fromEntries(
    ['sort', 'dir', ...config.filterKeys].map((queryKey) => [queryKey, parseAsString])
  )
  const [preferenceQuery] = useQueryStates(preferenceQueryParsers, {
    urlKeys: config.preferenceUrlKeys,
  })

  const defaultPreference = useMemo(
    () => normalizePreference(config.defaultPreference, config),
    [config]
  )
  const currentPreference = useMemo(
    () => normalizePreference(preference, config),
    [config, preference]
  )
  const hasEffectiveUrlPreference = Boolean(
    currentPreference &&
      defaultPreference &&
      !resourceListPreferencesEqual(currentPreference, defaultPreference)
  )
  const hasExplicitUrlPreference = Object.values(preferenceQuery).some((value) => value !== null)
  const hasUrlPreference = hasExplicitUrlPreference || hasEffectiveUrlPreference

  const rememberPreference = useCallback(
    (normalizedPreference: ResourceListPreference) => {
      if (!defaultPreference) return
      if (resourceListPreferencesEqual(normalizedPreference, defaultPreference)) {
        removePreference(workspaceId, config.module)
      } else {
        setPreference(workspaceId, config.module, normalizedPreference)
      }
    },
    [config.module, defaultPreference, removePreference, setPreference, workspaceId]
  )

  useEffect(() => {
    if (!enabled || hasHydrated || hydrationRequestedRef.current) return
    hydrationRequestedRef.current = true
    void useResourceListPreferencesStore.persist.rehydrate()
  }, [enabled, hasHydrated])

  useEffect(() => {
    if (!enabled || !hasHydrated) return

    if (pendingRestoration?.key === key) {
      if (
        currentPreference &&
        resourceListPreferencesEqual(currentPreference, pendingRestoration.preference)
      ) {
        setPendingRestoration(null)
        setReadyKey(key)
      } else if (currentPreference && hasExplicitUrlPreference) {
        setPendingRestoration(null)
        rememberPreference(currentPreference)
        setReadyKey(key)
      }
      return
    }

    if (pendingRestoration) setPendingRestoration(null)
    if (initializedKeyRef.current === key) return
    initializedKeyRef.current = key

    if (!currentPreference || !defaultPreference) {
      setReadyKey(key)
      return
    }

    if (hasUrlPreference) {
      rememberPreference(currentPreference)
      setReadyKey(key)
      return
    }

    const normalizedSaved = normalizePreference(savedPreference, config)
    if (!normalizedSaved || resourceListPreferencesEqual(normalizedSaved, defaultPreference)) {
      if (savedPreference) removePreference(workspaceId, config.module)
      setReadyKey(key)
      return
    }

    setPendingRestoration({ key, preference: normalizedSaved })
    void applyPreference(normalizedSaved)
  }, [
    applyPreference,
    config,
    currentPreference,
    defaultPreference,
    enabled,
    hasExplicitUrlPreference,
    hasHydrated,
    hasUrlPreference,
    key,
    pendingRestoration,
    rememberPreference,
    removePreference,
    savedPreference,
    workspaceId,
  ])

  const commitPreference = useCallback(
    (nextPreference: ResourceListPreference) => {
      const normalized = normalizePreference(nextPreference, config)
      if (!normalized) return
      rememberPreference(normalized)
      void applyPreference(normalized)
    },
    [applyPreference, config, rememberPreference]
  )

  const setFilter = useCallback(
    (filterKey: string, values: string[]) => {
      if (!currentPreference || !config.filterKeys.includes(filterKey)) return
      commitPreference({
        ...currentPreference,
        filters: { ...currentPreference.filters, [filterKey]: values },
      })
    },
    [commitPreference, config.filterKeys, currentPreference]
  )

  const clearFilters = useCallback(() => {
    if (!currentPreference) return
    commitPreference({
      ...currentPreference,
      filters: Object.fromEntries(config.filterKeys.map((filterKey) => [filterKey, []])),
    })
  }, [commitPreference, config.filterKeys, currentPreference])

  const setSort = useCallback(
    (column: string, direction: ResourceListPreference['sort']['direction']) => {
      if (!currentPreference) return
      commitPreference({ ...currentPreference, sort: { column, direction } })
    },
    [commitPreference, currentPreference]
  )

  const clearSort = useCallback(() => {
    if (!currentPreference || !defaultPreference) return
    commitPreference({ ...currentPreference, sort: { ...defaultPreference.sort } })
  }, [commitPreference, currentPreference, defaultPreference])

  return {
    isReady: !enabled || (pendingRestoration?.key !== key && hasUrlPreference) || readyKey === key,
    setFilter,
    clearFilters,
    setSort,
    clearSort,
  }
}
