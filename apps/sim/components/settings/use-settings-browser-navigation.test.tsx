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
const nativeGo = window.history.go

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
  it.each([
    { kind: 'Map', state: new Map([['router', 'map-state']]) },
    { kind: 'Date', state: new Date('2026-01-01T00:00:00Z') },
    { kind: 'typed array', state: new Uint8Array([1, 2, 3]) },
    { kind: 'array', state: ['preserved', 'state'] },
  ])('preserves $kind state through push and replacement', async ({ state }) => {
    window.history.pushState(state, '', '/structured-state')
    expect(window.history.state).toEqual(state)
    window.history.replaceState(state, '', '/replaced-state')
    expect(window.history.state).toEqual(state)
    window.history.back()
    await settle()
    window.history.forward()
    await settle()
    expect(window.history.state).toEqual(state)
  })

  it('does not reuse confirmation from a traversal that emitted no event for a later draft', async () => {
    act(() => root.render(<LinkedEditor />))
    const field = container.querySelector<HTMLInputElement>('input[aria-label="Draft"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!field || !setter) throw new Error('Missing draft input')
    act(() => {
      setter.call(field, 'original draft')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const steps = window.history.length
    window.history.go(-steps)
    act(() => useSettingsDirtyStore.getState().confirmLeave())
    await settle()
    expect(window.location.pathname).toBe('/editor')
    expect(field.value).toBe('')
    for (let index = 0; index < steps; index++)
      window.history.pushState({ router: 'later' }, '', `/later-${index}`)
    const currentPath = window.location.pathname
    act(() => {
      setter.call(field, 'new draft')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    nativeGo.call(window.history, -steps)
    await settle()
    expect(window.location.pathname).toBe(currentPath)
    expect(routedPaths).toEqual([])
    expect(field.value).toBe('new draft')
    expect(useSettingsDirtyStore.getState().pendingLeave).not.toBeNull()
  })

  it.each(['pushState', 'replaceState'] as const)(
    'cancels a stale confirmation when %s changes its source',
    async (method) => {
      act(() => root.render(<LinkedEditor />))
      const field = container.querySelector<HTMLInputElement>('input[aria-label="Draft"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (!field || !setter) throw new Error('Missing draft input')
      act(() => {
        setter.call(field, 'authored')
        field.dispatchEvent(new Event('input', { bubbles: true }))
      })
      window.history.back()
      expect(useSettingsDirtyStore.getState().pendingLeave).not.toBeNull()
      window.history[method]({ router: 'new-source' }, '', '/new-source')
      expect(useSettingsDirtyStore.getState().pendingLeave).toBeNull()
      act(() => useSettingsDirtyStore.getState().confirmLeave())
      await settle()
      expect(window.location.pathname).toBe('/new-source')
      expect(field.value).toBe('authored')
    }
  )

  it.each([
    { kind: 'metadata-only replacement', native: false },
    { kind: 'metadata-only replacement', native: true },
    { kind: 'rejected push', native: false },
    { kind: 'rejected replacement', native: false },
  ])(
    'preserves the active confirmation after a $kind (native: $native)',
    async ({ kind, native }) => {
      render(true)
      if (native) {
        nativeGo.call(window.history, -1)
        await settle()
      } else window.history.back()
      expect(useSettingsDirtyStore.getState().pendingLeave).not.toBeNull()
      if (kind === 'metadata-only replacement')
        window.history.replaceState({ router: 'updated-metadata' }, '', window.location.href)
      else {
        const method = kind === 'rejected push' ? 'pushState' : 'replaceState'
        expect(() => window.history[method]({}, '', 'https://other.example.com')).toThrow()
      }
      expect(useSettingsDirtyStore.getState().pendingLeave).not.toBeNull()
      act(() => useSettingsDirtyStore.getState().confirmLeave())
      await settle()
      expect(window.location.pathname).toBe('/prior')
    }
  )

  it('supersedes an older leave dialog when programmatic traversal stays on the same page', async () => {
    act(() => root.render(<LinkedEditor />))
    const field = container.querySelector<HTMLInputElement>('input[aria-label="Draft"]')
    const link = container.querySelector<HTMLAnchorElement>('a[href="/other"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!field || !link || !setter) throw new Error('Missing linked editor')
    window.history.pushState({ router: 'hash' }, '', '/editor#details')
    act(() => {
      setter.call(field, 'authored')
      field.dispatchEvent(new Event('input', { bubbles: true }))
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(useSettingsDirtyStore.getState().pendingLeave).not.toBeNull()
    window.history.back()
    await settle()
    expect(useSettingsDirtyStore.getState().pendingLeave).toBeNull()
    act(() => useSettingsDirtyStore.getState().confirmLeave())
    expect(window.location.pathname).toBe('/editor')
    expect(field.value).toBe('authored')
  })

  it('guards programmatic Forward to an entry created before tracking began', async () => {
    nativePush.call(window.history, { router: 'legacy-forward' }, '', '/legacy-forward')
    nativeGo.call(window.history, -1)
    await settle()
    routedPaths = []
    render(true)
    window.history.forward()
    await settle()
    expect(window.location.pathname).toBe('/editor')
    expect(routedPaths).toEqual([])
    expect(useSettingsDirtyStore.getState().pendingLeave).not.toBeNull()
    act(() => useSettingsDirtyStore.getState().confirmLeave())
    await settle()
    expect(window.location.pathname).toBe('/legacy-forward')
  })

  it.each([false, true])(
    'does not guess an unindexed native direction and recovers indexed history after a rejected push: %s',
    async (rejectPush) => {
      nativePush.call(window.history, { router: 'legacy-forward' }, '', '/legacy-forward')
      nativePush.call(window.history, { router: 'legacy-far' }, '', '/legacy-far')
      nativeGo.call(window.history, -2)
      await settle()
      routedPaths = []
      render(true)
      nativeGo.call(window.history, 1)
      await settle()
      expect(window.location.pathname).toBe('/legacy-forward')
      expect(routedPaths).toEqual(['/legacy-forward'])
      if (rejectPush)
        expect(() => window.history.pushState({}, '', 'https://other.example.com')).toThrow()
      nativeGo.call(window.history, -1)
      await settle()
      expect(window.location.pathname).toBe('/editor')
      nativeGo.call(window.history, -1)
      await settle()
      expect(window.location.pathname).toBe('/editor')
      expect(useSettingsDirtyStore.getState().pendingLeave).not.toBeNull()
    }
  )

  it('allows native traversal within the same page hash while a draft is protected', async () => {
    window.history.pushState({ router: 'hash' }, '', '/editor#first')
    render(true)
    nativeGo.call(window.history, -1)
    await settle()
    expect(window.location.pathname).toBe('/editor')
    expect(window.location.hash).toBe('')
    expect(useSettingsDirtyStore.getState().pendingLeave).toBeNull()
  })

  it.each(['back', 'forward', 'go'] as const)(
    'preserves a draft during programmatic hash-only %s',
    async (method) => {
      act(() => root.render(<LinkedEditor />))
      const field = container.querySelector<HTMLInputElement>('input[aria-label="Draft"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (!field || !setter) throw new Error('Missing draft input')
      window.history.pushState({ router: 'hash' }, '', '/editor#first')
      if (method === 'forward') {
        nativeGo.call(window.history, -1)
        await settle()
      }
      act(() => {
        setter.call(field, 'authored')
        field.dispatchEvent(new Event('input', { bubbles: true }))
      })
      if (method === 'go') window.history.go(-1)
      else window.history[method]()
      await settle()
      expect(useSettingsDirtyStore.getState().pendingLeave).toBeNull()
      expect(window.location.hash).toBe(method === 'forward' ? '#first' : '')
      expect(field.value).toBe('authored')
      expect(useSettingsDirtyStore.getState().isDirty).toBe(true)
      if (method !== 'forward') {
        window.history.back()
        await settle()
        expect(window.location.pathname).toBe('/editor')
        expect(useSettingsDirtyStore.getState().pendingLeave).not.toBeNull()
      }
    }
  )

  it('keeps Back and Forward on the edited page until discard is confirmed', async () => {
    render(true)
    nativeGo.call(window.history, -1)
    await settle()
    expect(window.location.pathname).toBe('/editor')
    expect(routedPaths).toEqual([])
    expect(useSettingsDirtyStore.getState().pendingLeave).not.toBeNull()
    act(() => useSettingsDirtyStore.getState().cancelLeave())
    expect(window.location.pathname).toBe('/editor')
    nativeGo.call(window.history, -1)
    await settle()
    expect(useSettingsDirtyStore.getState().pendingLeave).not.toBeNull()
    act(() => useSettingsDirtyStore.getState().confirmLeave())
    await settle()
    expect(window.location.pathname).toBe('/prior')
    expect(routedPaths).toEqual(['/prior'])
    expect(useSettingsDirtyStore.getState().isDirty).toBe(true)
    nativeGo.call(window.history, 1)
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
