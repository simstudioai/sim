import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { isEqual } from 'es-toolkit'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { buildCanonicalIndex, resolveDependencyValue } from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks/registry'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

export interface FetchedOption {
  label: string
  id: string
}

/** An option the control already knows about, static or previously fetched. */
type LocalOption = string | { id: string }

interface UseFetchedOptionsProps {
  blockId: string
  /** Sibling subblock ids this list is scoped by; a change refetches. */
  dependsOnFields: string[]
  fetchOptions?: (blockId: string) => Promise<FetchedOption[]>
  fetchOptionById?: (blockId: string, optionId: string) => Promise<FetchedOption | null>
  isPreview: boolean
  disabled: boolean
  /**
   * The stored value whose label needs resolving before the full list loads.
   * Multi-select controls pass `null` — there is no single label to hydrate.
   */
  valueToHydrate: string | null | undefined
  /** Options already resolvable without a fetch, so hydration can skip one. */
  localOptions: readonly LocalOption[]
}

export interface UseFetchedOptionsResult {
  fetchedOptions: FetchedOption[]
  isLoadingOptions: boolean
  fetchError: string | null
  hydratedOption: FetchedOption | null
  /** Fetches now, bypassing the once-per-dependency-set guard. For open handlers. */
  refetch: () => void
}

function hasLocalOption(options: readonly LocalOption[], id: string): boolean {
  return options.some((option) => (typeof option === 'string' ? option === id : option.id === id))
}

/**
 * Owns the async-option lifecycle shared by the Dropdown and ComboBox subblock
 * controls: fetching the list, clearing and refetching it when the fields it
 * depends on change, and hydrating a stored value's label before the list loads.
 *
 * This exists as one hook because the two controls previously carried the same
 * ~115 lines twice and drifted: a fix that added a `hasFetched` guard to both
 * added the matching reset to only one, leaving every dependent Dropdown unable
 * to refetch after its dependency changed.
 */
export function useFetchedOptions({
  blockId,
  dependsOnFields,
  fetchOptions,
  fetchOptionById,
  isPreview,
  disabled,
  valueToHydrate,
  localOptions,
}: UseFetchedOptionsProps): UseFetchedOptionsResult {
  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId)
  const blockState = useWorkflowStore((state) => state.blocks[blockId])
  const blockConfig = blockState?.type ? getBlock(blockState.type) : null
  const canonicalModeOverrides = blockState?.data?.canonicalModes
  const canonicalIndex = useMemo(
    () => buildCanonicalIndex(blockConfig?.subBlocks || []),
    [blockConfig?.subBlocks]
  )

  const dependencyValues = useStoreWithEqualityFn(
    useSubBlockStore,
    useCallback(
      (state) => {
        if (dependsOnFields.length === 0 || !activeWorkflowId) return []
        const workflowValues = state.workflowValues[activeWorkflowId] || {}
        const blockValues = workflowValues[blockId] || {}
        return dependsOnFields.map((depKey) =>
          resolveDependencyValue(depKey, blockValues, canonicalIndex, canonicalModeOverrides)
        )
      },
      [dependsOnFields, activeWorkflowId, blockId, canonicalIndex, canonicalModeOverrides]
    ),
    isEqual
  )

  const [fetchedOptions, setFetchedOptions] = useState<FetchedOption[]>([])
  const [isLoadingOptions, setIsLoadingOptions] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [hydratedOption, setHydratedOption] = useState<FetchedOption | null>(null)

  const previousDependencyValuesRef = useRef<string>('')
  /**
   * Whether a fetch has already been attempted for the current dependency values.
   * "Have we fetched?" cannot be inferred from `fetchedOptions.length === 0` — a
   * fetcher that legitimately returns no options (a workspace with no sandboxes,
   * no credential selected) leaves the length at 0 while the loading flag flips
   * back to false, re-satisfying the effect's guards and spinning it forever.
   */
  const hasFetchedRef = useRef(false)

  const runFetch = useCallback(async () => {
    if (!fetchOptions || isPreview || disabled) return

    setIsLoadingOptions(true)
    setFetchError(null)
    try {
      const options = await fetchOptions(blockId)
      setFetchedOptions(options)
    } catch (error) {
      setFetchError(getErrorMessage(error, 'Failed to fetch options'))
      setFetchedOptions([])
    } finally {
      setIsLoadingOptions(false)
    }
  }, [fetchOptions, blockId, isPreview, disabled])

  useEffect(() => {
    if (!fetchOptions || dependsOnFields.length === 0) return

    const current = JSON.stringify(dependencyValues)
    const previous = previousDependencyValuesRef.current
    if (previous && current !== previous) {
      setFetchedOptions([])
      setHydratedOption(null)
      // Both flags are what gate the fetch effect below, so both have to clear
      // with the list: a stale error would block every future refetch, and a
      // stale `hasFetched` would stop the new dependency values ever loading.
      setFetchError(null)
      hasFetchedRef.current = false
    }
    previousDependencyValuesRef.current = current
  }, [dependencyValues, fetchOptions, dependsOnFields.length])

  useEffect(() => {
    if (
      fetchOptions &&
      !isPreview &&
      !disabled &&
      !hasFetchedRef.current &&
      !isLoadingOptions &&
      !fetchError
    ) {
      hasFetchedRef.current = true
      void runFetch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runFetch deps already covered above
  }, [fetchOptions, isPreview, disabled, isLoadingOptions, fetchError, dependencyValues])

  useEffect(() => {
    if (!fetchOptionById || isPreview || disabled) return
    if (!valueToHydrate) return

    // An expression rather than a real id — there is nothing to look up.
    if (valueToHydrate.startsWith('<') || valueToHydrate.includes('{{')) return

    if (hydratedOption?.id === valueToHydrate) return
    if (hasLocalOption(fetchedOptions, valueToHydrate)) return
    if (hasLocalOption(localOptions, valueToHydrate)) return

    let isActive = true
    fetchOptionById(blockId, valueToHydrate)
      .then((option) => {
        if (isActive) setHydratedOption(option)
      })
      .catch(() => {
        if (isActive) setHydratedOption(null)
      })

    return () => {
      isActive = false
    }
  }, [
    fetchOptionById,
    valueToHydrate,
    blockId,
    isPreview,
    disabled,
    fetchedOptions,
    localOptions,
    hydratedOption?.id,
  ])

  const refetch = useCallback(() => {
    hasFetchedRef.current = true
    void runFetch()
  }, [runFetch])

  return { fetchedOptions, isLoadingOptions, fetchError, hydratedOption, refetch }
}
