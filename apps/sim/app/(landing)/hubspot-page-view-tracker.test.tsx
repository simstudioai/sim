/**
 * @vitest-environment jsdom
 */
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { navigation } = vi.hoisted(() => ({ navigation: { pathname: '/pricing' } }))

vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }))

import { HubspotPageViewTracker } from '@/app/(landing)/hubspot-page-view-tracker'

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  navigation.pathname = '/pricing'
  window._hsq = []
})

describe('HubspotPageViewTracker', () => {
  it('tracks later paths once without query data under Strict Mode', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    root = createRoot(container)
    window._hsq = []

    act(() =>
      root?.render(
        <StrictMode>
          <HubspotPageViewTracker />
        </StrictMode>
      )
    )
    expect(window._hsq).toEqual([])

    navigation.pathname = '/demo'
    act(() =>
      root?.render(
        <StrictMode>
          <HubspotPageViewTracker />
        </StrictMode>
      )
    )

    expect(window._hsq).toEqual([['setPath', '/demo'], ['trackPageView']])
  })
})
