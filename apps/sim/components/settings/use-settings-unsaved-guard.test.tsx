/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsUnsavedGuard } from '@/components/settings/use-settings-unsaved-guard'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

interface EditorProps {
  dirty: boolean
  blocked?: boolean
}

function Editor({ dirty, blocked }: EditorProps) {
  useSettingsUnsavedGuard({ isDirty: dirty, navigationBlocked: blocked })
  return null
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useSettingsDirtyStore.getState().reset()
  container = document.createElement('div')
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(first: EditorProps, second?: EditorProps) {
  act(() =>
    root.render(
      <>
        <Editor key='first' {...first} />
        {second && <Editor key='second' {...second} />}
      </>
    )
  )
}

function attemptLeave() {
  let left = false
  act(() =>
    useSettingsDirtyStore.getState().requestLeave(() => {
      left = true
    })
  )
  return left
}

describe('settings navigation across multiple editors', () => {
  it('keeps a dirty editor protected when a clean sibling mounts and unmounts', () => {
    render({ dirty: true }, { dirty: false })
    expect(attemptLeave()).toBe(false)
    render({ dirty: true })
    expect(attemptLeave()).toBe(false)
    render({ dirty: false })
    expect(attemptLeave()).toBe(true)
  })

  it('keeps a mounted draft protected after an attempted confirmed departure', () => {
    render({ dirty: true })
    let departures = 0
    act(() =>
      useSettingsDirtyStore.getState().requestLeave(() => {
        departures++
      })
    )
    act(() => useSettingsDirtyStore.getState().confirmLeave())
    expect(departures).toBe(1)
    expect(attemptLeave()).toBe(false)
  })

  it('cancels a pending discard when every editor becomes clean without navigating', () => {
    render({ dirty: true })
    let departures = 0
    act(() =>
      useSettingsDirtyStore.getState().requestLeave(() => {
        departures++
      })
    )
    render({ dirty: false })
    expect(useSettingsDirtyStore.getState().pendingLeave).toBeNull()
    act(() => useSettingsDirtyStore.getState().confirmLeave())
    expect(departures).toBe(0)
    expect(attemptLeave()).toBe(true)
  })

  it('keeps navigation blocked until the last pending editor finishes', () => {
    render({ dirty: false, blocked: true }, { dirty: false, blocked: false })
    expect(attemptLeave()).toBe(false)
    expect(useSettingsDirtyStore.getState().pendingLeave).toBeNull()
    render({ dirty: false, blocked: true })
    expect(attemptLeave()).toBe(false)
    render({ dirty: false, blocked: false })
    expect(attemptLeave()).toBe(true)
  })
})
