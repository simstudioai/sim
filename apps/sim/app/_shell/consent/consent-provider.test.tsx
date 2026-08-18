/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockConsentManagerProvider, mockConsentBanner } = vi.hoisted(() => ({
  mockConsentManagerProvider: vi.fn(),
  mockConsentBanner: vi.fn(),
}))

vi.mock('@c15t/nextjs/headless', () => ({
  ConsentManagerProvider: (props: { children: ReactNode; options: unknown }) => {
    mockConsentManagerProvider(props.options)
    return props.children
  },
}))

vi.mock('@/app/_shell/consent/consent-banner', () => ({
  ConsentBanner: () => {
    mockConsentBanner()
    return null
  },
}))

import { ConsentProvider } from '@/app/_shell/consent/consent-provider'

let root: Root | null = null

/** Mounts the provider in a real React 19 root under jsdom. */
function renderProvider(enabled: boolean): HTMLDivElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(
      <ConsentProvider enabled={enabled}>
        <span data-testid='app'>app</span>
      </ConsentProvider>
    )
  })
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.clearAllMocks()
})

describe('ConsentProvider', () => {
  it('mounts no consent runtime and no banner when disabled', () => {
    const container = renderProvider(false)

    expect(container.querySelector('[data-testid="app"]')).not.toBeNull()
    expect(mockConsentManagerProvider).not.toHaveBeenCalled()
    expect(mockConsentBanner).not.toHaveBeenCalled()
  })

  it('mounts the runtime and banner against the hosted backend when enabled', () => {
    const container = renderProvider(true)

    expect(container.querySelector('[data-testid="app"]')).not.toBeNull()
    expect(mockConsentBanner).toHaveBeenCalled()
    expect(mockConsentManagerProvider).toHaveBeenCalledWith({
      mode: 'hosted',
      backendURL: 'https://sim-sim.inth.app',
      consentCategories: ['necessary', 'measurement', 'marketing'],
    })
  })
})
