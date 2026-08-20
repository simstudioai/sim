import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { isEqual } from 'es-toolkit'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { buildSelectorContextFromBlock } from '@/lib/workflows/subblocks/context'
import { buildCanonicalIndex, resolveDependencyValue } from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks/registry'
import { getSelectorDefinition, loadAllSelectorOptions } from '@/hooks/selectors/registry'
import type { SelectorKey } from '@/hooks/selectors/types'
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
  /**
   * The registered selector supplying this control's options.
   *
   * This is the ONLY way a sub-block loads a remote list. A selector is parameterized by an
   * explicit {@link SelectorContext} built from the block's own values, so the same definition
   * serves the canvas, the fork sync modal, and any future surface. The alternative that used
   * to live here — a per-block `fetchOptions(blockId)` reading the live store — could only ever
   * work on the canvas, and was in every case a duplicate of a selector that already existed.
   */
  selectorKey?: SelectorKey
  /** Drop the hosting workflow from the list — see `SubBlockConfig.selectorExcludeSelf`. */
  selectorExcludeSelf?: boolean
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
  /**
   * Whether this control loads its options remotely at all. Controls use it to decide whether
   * `fetchedOptions` or the static `options` array is authoritative — a question they used to
   * answer by testing the `fetchOptions` prop, which stops being true once the source is a
   * `selectorKey` instead.
   */
  isDynamic: boolean
  isLoadingOptions: boolean
  fetchError: string | null
  hydratedOption: FetchedOption | null
  /** Stored id an authoritative lookup confirmed no longer exists. */
  missingOptionId: string | null
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
  selectorKey,
  selectorExcludeSelf,
  isPreview,
  disabled,
  valueToHydrate,
  localOptions,
}: UseFetchedOptionsProps): UseFetchedOptionsResult {
  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId)
  const workspaceId = useWorkflowRegistry((s) => s.hydration.workspaceId)
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

  /**
   * The block's live sub-block values merged over its persisted ones — the shape
   * `buildSelectorContextFromBlock` reads. Resolved at call time rather than memoized so a
   * selector always fetches against what the user has actually chosen, not a stale snapshot.
   */
  const readSelectorContext = useCallback(() => {
    const block = useWorkflowStore.getState().blocks[blockId]
    if (!block?.type) return null
    const live = activeWorkflowId
      ? (useSubBlockStore.getState().workflowValues[activeWorkflowId]?.[blockId] ?? {})
      : {}
    const merged: Record<string, { value?: unknown }> = { ...(block.subBlocks ?? {}) }
    for (const [id, value] of Object.entries(live)) merged[id] = { ...merged[id], value }
    const context = buildSelectorContextFromBlock(block.type, merged, {
      workflowId: activeWorkflowId ?? undefined,
      workspaceId: workspaceId ?? undefined,
      canonicalModes: block.data?.canonicalModes,
    })
    if (selectorExcludeSelf && activeWorkflowId) context.excludeWorkflowId = activeWorkflowId
    return context
  }, [blockId, activeWorkflowId, workspaceId, selectorExcludeSelf])

  const selectorDefinition = selectorKey ? getSelectorDefinition(selectorKey) : undefined

  /**
   * A selector-backed control reuses this hook's whole lifecycle by presenting the registry
   * through the same two function shapes the props already describe — so there is one fetch
   * path, not a second system running alongside it.
   *
   * Memoized on `dependencyValues` so a changed parent (a newly picked credential) yields a
   * new identity and the scope reset below refetches, exactly as it does for a prop fetcher.
   */
  const fetchOptions = useMemo(() => {
    if (!selectorDefinition) return undefined
    const definition = selectorDefinition
    return async (): Promise<FetchedOption[]> => {
      const context = readSelectorContext()
      if (!context) return []
      const args = { key: definition.key, context }
      // The selector's own readiness gate: an unset credential yields an empty list rather
      // than an error, which is how every other selector-backed control already behaves.
      if (definition.enabled && !definition.enabled(args)) return []
      // Shared with search/replace and value resolution, so a paginated selector drains the
      // same bounded way here as everywhere else instead of silently showing one page.
      const options = await loadAllSelectorOptions(definition, args)
      return options.map((option) => ({ id: option.id, label: option.label }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dependencyValues is the refetch scope
  }, [selectorDefinition, readSelectorContext, dependencyValues])

  /** Label hydration for a stored id, from the same definition. */
  const fetchOptionById = useMemo(() => {
    const definition = selectorDefinition
    const fetchById = definition?.fetchById
    if (!definition || !fetchById) return undefined
    return async (_blockId: string, optionId: string, signal?: AbortSignal) => {
      const context = readSelectorContext()
      if (!context) return null
      const option = await fetchById({ key: definition.key, context, detailId: optionId, signal })
      return option ? { id: option.id, label: option.label } : null
    }
  }, [selectorDefinition, readSelectorContext])

  const [fetchedOptions, setFetchedOptions] = useState<FetchedOption[]>([])
  const [isLoadingOptions, setIsLoadingOptions] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [hydratedOption, setHydratedOption] = useState<FetchedOption | null>(null)
  const [missingOptionId, setMissingOptionId] = useState<string | null>(null)
  const [hydrationRevision, setHydrationRevision] = useState(0)
  const hydratedRevisionRef = useRef<{ id: string; revision: number } | null>(null)
  const fetchRequestIdRef = useRef(0)

  const previousFetchScopeRef = useRef<string>('')
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

    const requestId = ++fetchRequestIdRef.current
    setIsLoadingOptions(true)
    setFetchError(null)
    try {
      const options = await fetchOptions()
      if (requestId !== fetchRequestIdRef.current) return
      setFetchedOptions(options)
    } catch (error) {
      if (requestId !== fetchRequestIdRef.current) return
      setFetchError(getErrorMessage(error, 'Failed to fetch options'))
      setFetchedOptions([])
    } finally {
      if (requestId === fetchRequestIdRef.current) {
        setIsLoadingOptions(false)
      }
    }
  }, [fetchOptions, blockId, isPreview, disabled])

  useEffect(() => {
    if (!fetchOptions) return

    const current = JSON.stringify([workspaceId, dependencyValues])
    const previous = previousFetchScopeRef.current
    if (previous && current !== previous) {
      fetchRequestIdRef.current += 1
      setFetchedOptions([])
      setIsLoadingOptions(false)
      setHydratedOption(null)
      setMissingOptionId(null)
      hydratedRevisionRef.current = null
      // Both flags are what gate the fetch effect below, so both have to clear
      // with the list: a stale error would block every future refetch, and a
      // stale `hasFetched` would stop the new dependency values ever loading.
      setFetchError(null)
      hasFetchedRef.current = false
    }
    previousFetchScopeRef.current = current
  }, [dependencyValues, fetchOptions, workspaceId])

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

    if (
      hydratedOption?.id === valueToHydrate &&
      hydratedRevisionRef.current?.id === valueToHydrate &&
      hydratedRevisionRef.current.revision === hydrationRevision
    ) {
      return
    }
    if (hasLocalOption(fetchedOptions, valueToHydrate)) return
    if (hasLocalOption(localOptions, valueToHydrate)) return

    let isActive = true
    fetchOptionById(blockId, valueToHydrate)
      .then((option) => {
        if (isActive) {
          hydratedRevisionRef.current = option
            ? { id: valueToHydrate, revision: hydrationRevision }
            : null
          setHydratedOption(option)
          setMissingOptionId(option ? null : valueToHydrate)
        }
      })
      .catch(() => {
        if (isActive) {
          setHydratedOption(null)
          setMissingOptionId(null)
        }
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
    hydrationRevision,
    workspaceId,
  ])

  const refetch = useCallback(() => {
    hasFetchedRef.current = true
    setHydrationRevision((revision) => revision + 1)
    void runFetch()
  }, [runFetch])

  return {
    fetchedOptions,
    isDynamic: Boolean(fetchOptions),
    isLoadingOptions,
    fetchError,
    hydratedOption,
    missingOptionId,
    refetch,
  }
}
