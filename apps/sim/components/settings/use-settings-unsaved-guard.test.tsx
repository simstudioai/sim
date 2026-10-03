/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsUnsavedGuard } from '@/components/settings/use-settings-unsaved-guard'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

function renderDisabledGuard() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const root: Root = createRoot(document.createElement('div'))
  let latest: ReturnType<typeof useSettingsUnsavedGuard>

  function Probe() {
    latest = useSettingsUnsavedGuard({ isDirty: true, enabled: false })
    return null
  }

  act(() => root.render(<Probe />))
  return { result: () => latest, unmount: () => act(() => root.unmount()) }
}

describe('useSettingsUnsavedGuard', () => {
  beforeEach(() => {
    useSettingsDirtyStore.getState().reset()
  })

  it('leaves global settings navigation clean when an embedded editor owns guarding', () => {
    const leave = vi.fn()
    const guard = renderDisabledGuard()

    expect(useSettingsDirtyStore.getState().isDirty).toBe(false)

    act(() => guard.result().guardBack(leave))

    expect(leave).toHaveBeenCalledOnce()
    expect(guard.result().showUnsavedModal).toBe(false)

    guard.unmount()
    expect(useSettingsDirtyStore.getState().isDirty).toBe(false)
  })
})
