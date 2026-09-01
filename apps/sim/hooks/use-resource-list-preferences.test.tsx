/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { filesListPreferenceConfig } from '@/app/workspace/[workspaceId]/files/search-params'
import { knowledgeListPreferenceConfig } from '@/app/workspace/[workspaceId]/knowledge/search-params'
import { tablesListPreferenceConfig } from '@/app/workspace/[workspaceId]/tables/search-params'
import { useResourceListPreferences } from '@/hooks/use-resource-list-preferences'
import {
  RESOURCE_LIST_PREFERENCES_STORAGE_KEY,
  type ResourceListPreference,
  useResourceListPreferencesStore,
} from '@/stores/resource-list-preferences'

const defaultPreference = filesListPreferenceConfig.defaultPreference
const filesConfig = filesListPreferenceConfig

const filteredPreference: ResourceListPreference = {
  sort: { column: 'name', direction: 'asc' },
  filters: { type: ['document'], size: [], uploadedBy: ['user-1'] },
}

interface HookProps {
  preference: ResourceListPreference
  applyPreference: (preference: ResourceListPreference) => void
  enabled?: boolean
}

const mountedRoots: Root[] = []

function renderPreferenceHook(props: HookProps, searchParams = '') {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.createElement('div'))
  mountedRoots.push(root)
  let result: ReturnType<typeof useResourceListPreferences>
  let currentProps = props
  let currentSearchParams = searchParams

  function Probe() {
    result = useResourceListPreferences({
      workspaceId: 'workspace-1',
      config: filesConfig,
      ...currentProps,
    })
    return null
  }

  const renderProbe = () => (
    <NuqsTestingAdapter hasMemory searchParams={currentSearchParams}>
      <Probe />
    </NuqsTestingAdapter>
  )

  act(() => root.render(renderProbe()))
  return {
    get current() {
      return result
    },
    rerender(nextProps: HookProps, nextSearchParams = currentSearchParams) {
      currentProps = nextProps
      currentSearchParams = nextSearchParams
      act(() => root.render(renderProbe()))
    },
  }
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function seedPreference(preference: ResourceListPreference, version = 1) {
  localStorage.setItem(
    RESOURCE_LIST_PREFERENCES_STORAGE_KEY,
    JSON.stringify({
      state: { preferences: { 'workspace-1': { files: preference } } },
      version,
    })
  )
}

describe('useResourceListPreferences', () => {
  beforeEach(() => {
    localStorage.clear()
    useResourceListPreferencesStore.setState({ preferences: {}, _hasHydrated: false })
    void useResourceListPreferencesStore.persist.clearStorage()
  })

  afterEach(() => {
    act(() => {
      for (const root of mountedRoots.splice(0)) root.unmount()
    })
    vi.restoreAllMocks()
  })

  it('uses module defaults on a clean first visit without a saved preference', async () => {
    const applyPreference = vi.fn()
    const result = renderPreferenceHook({ preference: defaultPreference, applyPreference })

    await flushEffects()

    expect(result.current.isReady).toBe(true)
    expect(applyPreference).not.toHaveBeenCalled()
    expect(useResourceListPreferencesStore.getState().preferences).toEqual({})
  })

  it('shows effective URL state immediately and remembers it after hydration', async () => {
    const applyPreference = vi.fn()
    const result = renderPreferenceHook({ preference: filteredPreference, applyPreference })

    expect(result.current.isReady).toBe(true)
    await flushEffects()
    expect(useResourceListPreferencesStore.getState().preferences).toEqual({
      'workspace-1': { files: filteredPreference },
    })
    expect(applyPreference).not.toHaveBeenCalled()
  })

  it.each(['sort=updated&dir=desc', 'uploaded-by='])(
    'honors explicitly default-valued URL state instead of restoring a saved preference (%s)',
    async (searchParams) => {
      seedPreference(filteredPreference)
      const applyPreference = vi.fn()
      const result = renderPreferenceHook(
        { preference: defaultPreference, applyPreference },
        searchParams
      )

      expect(result.current.isReady).toBe(true)
      await flushEffects()
      expect(applyPreference).not.toHaveBeenCalled()
      expect(useResourceListPreferencesStore.getState().preferences).toEqual({})
    }
  )

  it('starts restoring a saved preference once on a clean visit', async () => {
    seedPreference(filteredPreference)
    const applyPreference = vi.fn()
    const result = renderPreferenceHook({ preference: defaultPreference, applyPreference })

    await flushEffects()
    expect(applyPreference).toHaveBeenCalledWith(filteredPreference)
    expect(result.current.isReady).toBe(false)
    expect(applyPreference).toHaveBeenCalledOnce()
  })

  it('stays unready until the restored URL snapshot becomes current', async () => {
    seedPreference(filteredPreference)
    const applyPreference = vi.fn()
    const result = renderPreferenceHook({ preference: defaultPreference, applyPreference })

    await flushEffects()

    expect(applyPreference).toHaveBeenCalledWith(filteredPreference)
    expect(result.current.isReady).toBe(false)

    result.rerender({ preference: filteredPreference, applyPreference })
    await flushEffects()

    expect(result.current.isReady).toBe(true)
    expect(applyPreference).toHaveBeenCalledOnce()
  })

  it('lets an explicit URL change cancel a pending saved-preference restoration', async () => {
    seedPreference(filteredPreference)
    const applyPreference = vi.fn()
    const result = renderPreferenceHook({ preference: defaultPreference, applyPreference })

    await flushEffects()
    expect(result.current.isReady).toBe(false)
    expect(applyPreference).toHaveBeenCalledWith(filteredPreference)

    result.rerender({ preference: defaultPreference, applyPreference }, 'sort=updated&dir=desc')
    await flushEffects()

    expect(result.current.isReady).toBe(true)
    expect(applyPreference).toHaveBeenCalledOnce()
    expect(useResourceListPreferencesStore.getState().preferences).toEqual({})
  })

  it('stays unready while a clean entry waits for hydration', () => {
    vi.spyOn(useResourceListPreferencesStore.persist, 'rehydrate').mockImplementation(
      () => new Promise(() => undefined)
    )
    const applyPreference = vi.fn()
    const result = renderPreferenceHook({ preference: defaultPreference, applyPreference })

    expect(result.current.isReady).toBe(false)
    expect(applyPreference).not.toHaveBeenCalled()
  })

  it('replaces a saved preference with the complete effective URL snapshot', async () => {
    seedPreference(filteredPreference)
    const urlPreference: ResourceListPreference = {
      sort: { column: 'size', direction: 'desc' },
      filters: { type: [], size: [], uploadedBy: [] },
    }
    const applyPreference = vi.fn()
    renderPreferenceHook({ preference: urlPreference, applyPreference })

    await flushEffects()
    expect(useResourceListPreferencesStore.getState().preferences).toEqual({
      'workspace-1': { files: urlPreference },
    })
    expect(applyPreference).not.toHaveBeenCalled()
  })

  it('does not merge omitted filters from a saved preference into a partial deep link', async () => {
    seedPreference(filteredPreference)
    const partialDeepLink: ResourceListPreference = {
      sort: { column: 'name', direction: 'desc' },
      filters: { type: [], size: [], uploadedBy: [] },
    }
    renderPreferenceHook({
      preference: partialDeepLink,
      applyPreference: vi.fn(),
    })

    await flushEffects()
    expect(useResourceListPreferencesStore.getState().preferences['workspace-1']?.files).toEqual(
      partialDeepLink
    )
  })

  it('discards module-incompatible saved state instead of applying it', async () => {
    seedPreference({
      sort: { column: 'unknown', direction: 'asc' },
      filters: { type: [], size: [], uploadedBy: [] },
    })
    const applyPreference = vi.fn()
    const result = renderPreferenceHook({ preference: defaultPreference, applyPreference })

    await flushEffects()
    expect(result.current.isReady).toBe(true)
    expect(applyPreference).not.toHaveBeenCalled()
    expect(useResourceListPreferencesStore.getState().preferences).toEqual({})
  })

  it('commits URL and stored state together and removes the default snapshot', async () => {
    const applyPreference = vi.fn()
    const result = renderPreferenceHook({ preference: defaultPreference, applyPreference })
    await flushEffects()
    expect(useResourceListPreferencesStore.getState()._hasHydrated).toBe(true)

    act(() => result.current.commitPreference(filteredPreference))

    expect(applyPreference).toHaveBeenCalledWith(filteredPreference)
    expect(useResourceListPreferencesStore.getState().preferences).toEqual({
      'workspace-1': { files: filteredPreference },
    })

    act(() => result.current.commitPreference(defaultPreference))

    expect(applyPreference).toHaveBeenCalledWith(defaultPreference)
    expect(useResourceListPreferencesStore.getState().preferences).toEqual({})
  })

  it('builds complete snapshots for filter and sort gestures', async () => {
    const applyPreference = vi.fn()
    const result = renderPreferenceHook({ preference: defaultPreference, applyPreference })
    await flushEffects()

    act(() => result.current.setFilter('type', ['image']))

    const filterPreference: ResourceListPreference = {
      ...defaultPreference,
      filters: { ...defaultPreference.filters, type: ['image'] },
    }
    expect(applyPreference).toHaveBeenLastCalledWith(filterPreference)
    expect(useResourceListPreferencesStore.getState().preferences['workspace-1']?.files).toEqual(
      filterPreference
    )

    act(() => result.current.setSort('name', 'asc'))

    const sortPreference: ResourceListPreference = {
      ...defaultPreference,
      sort: { column: 'name', direction: 'asc' },
    }
    expect(applyPreference).toHaveBeenLastCalledWith(sortPreference)
    expect(useResourceListPreferencesStore.getState().preferences['workspace-1']?.files).toEqual(
      sortPreference
    )
  })

  it('keeps URL commits working when localStorage writes fail', async () => {
    const applyPreference = vi.fn()
    const result = renderPreferenceHook({ preference: defaultPreference, applyPreference })
    await flushEffects()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is full', 'QuotaExceededError')
    })

    act(() => result.current.setFilter('type', ['image']))

    expect(applyPreference).toHaveBeenCalledWith({
      ...defaultPreference,
      filters: { ...defaultPreference.filters, type: ['image'] },
    })
  })

  it('clears filters and sort back to their complete module defaults', async () => {
    const applyPreference = vi.fn()
    const result = renderPreferenceHook({ preference: filteredPreference, applyPreference })
    await flushEffects()

    act(() => result.current.clearFilters())
    expect(applyPreference).toHaveBeenLastCalledWith({
      ...filteredPreference,
      filters: { type: [], size: [], uploadedBy: [] },
    })

    act(() => result.current.clearSort())
    expect(applyPreference).toHaveBeenLastCalledWith({
      ...filteredPreference,
      sort: defaultPreference.sort,
    })
  })

  it('does not reconcile or persist when the module list is disabled', async () => {
    seedPreference(filteredPreference)
    const applyPreference = vi.fn()
    const result = renderPreferenceHook({
      preference: defaultPreference,
      applyPreference,
      enabled: false,
    })

    expect(result.current.isReady).toBe(true)
    await flushEffects()
    expect(applyPreference).not.toHaveBeenCalled()
    expect(useResourceListPreferencesStore.getState().preferences).toEqual({})
  })
})

describe('module list preference configs', () => {
  it.each([
    [filesListPreferenceConfig, 'files', ['type', 'size', 'uploadedBy']],
    [tablesListPreferenceConfig, 'tables', ['rows', 'owner']],
    [knowledgeListPreferenceConfig, 'knowledge', ['connector', 'content', 'owner']],
  ])('defines the complete %s filter snapshot and shared default sort', (config, module, keys) => {
    expect(config.module).toBe(module)
    expect(config.filterKeys).toEqual(keys)
    expect(config.defaultPreference).toEqual({
      sort: { column: 'updated', direction: 'desc' },
      filters: Object.fromEntries(keys.map((key) => [key, []])),
    })
  })

  it('reuses the Files filter URL alias when detecting explicit preferences', () => {
    expect(filesListPreferenceConfig.preferenceUrlKeys).toEqual({ uploadedBy: 'uploaded-by' })
  })
})
