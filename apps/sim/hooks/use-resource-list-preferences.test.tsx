/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { filesListPreferenceConfig } from '@/app/workspace/[workspaceId]/files/search-params'
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

  it('keeps URL commits working when localStorage writes fail', async () => {
    const applyPreference = vi.fn()
    const result = renderPreferenceHook({ preference: defaultPreference, applyPreference })
    await flushEffects()
    const storageWrite = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is full', 'QuotaExceededError')
    })

    act(() => result.current.setFilter('type', ['image']))

    expect(applyPreference).toHaveBeenCalledWith({
      ...defaultPreference,
      filters: { ...defaultPreference.filters, type: ['image'] },
    })
    storageWrite.mockRestore()
  })
})
