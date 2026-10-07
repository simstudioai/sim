/** @vitest-environment jsdom */

import { act, useState } from 'react'
import { nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsIntentLink } from '@/components/settings/settings-intent-link'
import { SettingsNavigationGuard } from '@/components/settings/settings-navigation-guard'
import { useSettingsBrowserNavigation } from '@/components/settings/use-settings-browser-navigation'
import { useSettingsUnsavedGuard } from '@/components/settings/use-settings-unsaved-guard'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

vi.mock(
  'next/navigation',
  async () => (await import('@sim/testing/mocks/next-navigation.mock')).nextNavigationMock
)

interface SurfaceProps {
  dirty: boolean
  blocked?: boolean
}

function Surface({ dirty, blocked }: SurfaceProps) {
  useSettingsBrowserNavigation()
  useSettingsUnsavedGuard({ isDirty: dirty, navigationBlocked: blocked })
  return null
}

function LinkedEditor() {
  const [value, setValue] = useState('')
  const guard = useSettingsUnsavedGuard({
    isDirty: value.length > 0,
    onDiscard: () => setValue(''),
  })
  return (
    <>
      <SettingsNavigationGuard />
      <input aria-label='Draft' value={value} onChange={(event) => setValue(event.target.value)} />
      <a href='/other'>Other page</a>
      <SettingsIntentLink
        href='/managed'
        data-settings-navigation='managed'
        onClick={(event) => {
          event.preventDefault()
          guard.guardBack(() => window.history.replaceState({ router: 'managed' }, '', '/managed'))
        }}
      >
        Settings tab
      </SettingsIntentLink>
    </>
  )
}

const nativePush = window.history.pushState

let root: Root
let container: HTMLDivElement
let routedPaths: string[]
let handleRoute: () => void

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100)
  })
}

function render(dirty: boolean, blocked = false) {
  act(() => root.render(<Surface dirty={dirty} blocked={blocked} />))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useSettingsDirtyStore.getState().reset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  nextNavigationMockFns.router.push.mockImplementation((url: string) =>
    window.history.pushState({ router: 'link' }, '', url)
  )
  window.history.replaceState({ router: 'start' }, '', '/start')
  render(false)
  window.history.pushState({ router: 'prior' }, '', '/prior')
  window.history.pushState({ router: 'editor' }, '', '/editor')
  routedPaths = []
  handleRoute = () => {
    routedPaths.push(window.location.pathname)
  }
  window.addEventListener('popstate', handleRoute)
})

afterEach(async () => {
  act(() => root.unmount())
  await settle()
  window.removeEventListener('popstate', handleRoute)
  container.remove()
  vi.useRealTimers()
})

describe('native settings navigation', () => {
  it('keeps Back and Forward on the edited page until discard is confirmed', async () => {
    render(true)
    window.history.back()
    await settle()
    expect(window.location.pathname).toBe('/editor')
    expect(routedPaths).toEqual([])
    expect(useSettingsDirtyStore.getState().pendingLeave).not.toBeNull()
    act(() => useSettingsDirtyStore.getState().cancelLeave())
    expect(window.location.pathname).toBe('/editor')
    window.history.back()
    await settle()
    expect(useSettingsDirtyStore.getState().pendingLeave).not.toBeNull()
    act(() => useSettingsDirtyStore.getState().confirmLeave())
    await settle()
    expect(window.location.pathname).toBe('/prior')
    expect(routedPaths).toEqual(['/prior'])
    expect(useSettingsDirtyStore.getState().isDirty).toBe(true)
    window.history.forward()
    await settle()
    expect(window.location.pathname).toBe('/prior')
    expect(useSettingsDirtyStore.getState().pendingLeave).not.toBeNull()
    act(() => useSettingsDirtyStore.getState().confirmLeave())
    await settle()
    expect(window.location.pathname).toBe('/editor')
    expect(window.history.state.router).toBe('editor')
  })

  it('keeps history indexing correct through a router wrapper and root effect remount', async () => {
    const push = window.history.pushState
    const replace = window.history.replaceState
    window.history.pushState = (data, unused, url) => push.call(window.history, data, unused, url)
    window.history.replaceState = (data, unused, url) =>
      replace.call(window.history, data, unused, url)
    act(() => root.unmount())
    root = createRoot(container)
    render(false)
    window.history.back()
    await settle()
    expect(window.location.pathname).toBe('/prior')
    window.history.pushState({ router: 'other' }, '', '/other')
    render(true)
    window.history.back()
    await settle()
    expect(window.location.pathname).toBe('/other')
    expect(useSettingsDirtyStore.getState().pendingLeave).not.toBeNull()
    act(() => useSettingsDirtyStore.getState().confirmLeave())
    await settle()
    expect(window.location.pathname).toBe('/prior')
  })

  it('keeps a rejected cross-origin push from corrupting blocked Back', async () => {
    expect(() => window.history.pushState({}, '', 'https://other.example.com')).toThrow()
    render(true)
    window.history.back()
    await settle()
    expect(window.location.pathname).toBe('/editor')
    expect(useSettingsDirtyStore.getState().pendingLeave).not.toBeNull()
  })

  it.each([1, 2])(
    'protects a %s-entry Back jump into history created before indexing began',
    async (steps) => {
      nativePush.call(window.history, { router: 'legacy' }, '', '/legacy')
      if (steps === 2) nativePush.call(window.history, { router: 'near' }, '', '/legacy-near')
      window.history.pushState({ router: 'editor' }, '', '/editor')
      render(true)
      window.history.go(-steps)
      await settle()
      expect(window.location.pathname).toBe('/editor')
      expect(routedPaths).toEqual([])
      expect(useSettingsDirtyStore.getState().pendingLeave).not.toBeNull()
      act(() => useSettingsDirtyStore.getState().confirmLeave())
      await settle()
      expect(window.location.pathname).toBe('/legacy')
      expect(window.history.state.router).toBe('legacy')
    }
  )

  it('protects ordinary internal links and discards the draft before confirmed navigation', () => {
    act(() => root.render(<LinkedEditor />))
    const input = container.querySelector('input')
    const link = container.querySelector('a')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!input || !link || !setter) throw new Error('Missing linked editor')
    act(() => {
      setter.call(input, 'Draft')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => link.dispatchEvent(click))
    expect(click.defaultPrevented).toBe(true)
    expect(window.location.pathname).toBe('/editor')
    expect(useSettingsDirtyStore.getState().pendingLeave).not.toBeNull()
    act(() => useSettingsDirtyStore.getState().confirmLeave())
    expect(window.location.pathname).toBe('/other')
    expect(container.querySelector('input')?.value).toBe('')
    expect(useSettingsDirtyStore.getState().isDirty).toBe(false)
  })

  it('preserves an owned settings link navigation callback and replacement history', () => {
    act(() => root.render(<LinkedEditor />))
    const input = container.querySelector('input')
    const link = container.querySelector<HTMLAnchorElement>('a[href="/managed"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!input || !link || !setter) throw new Error('Missing owned settings link')
    act(() => {
      setter.call(input, 'Draft')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const length = window.history.length
    act(() => link.click())
    expect(window.location.pathname).toBe('/editor')
    act(() => useSettingsDirtyStore.getState().confirmLeave())
    expect(window.location.pathname).toBe('/managed')
    expect(window.history.length).toBe(length)
  })

  it('allows clean history traversal without adding entries across edit and revert cycles', async () => {
    const length = window.history.length
    render(true)
    render(false)
    render(true)
    render(false)
    await settle()
    expect(window.history.length).toBe(length)
    window.history.back()
    await settle()
    expect(window.location.pathname).toBe('/prior')
    expect(useSettingsDirtyStore.getState().pendingLeave).toBeNull()
  })

  it('blocks unload and history while saving even after optimistic state becomes clean', async () => {
    render(false, true)
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
    window.history.back()
    await settle()
    expect(window.location.pathname).toBe('/editor')
    expect(useSettingsDirtyStore.getState().pendingLeave).toBeNull()
    render(false)
    window.history.back()
    await settle()
    expect(window.location.pathname).toBe('/prior')
  })
})
