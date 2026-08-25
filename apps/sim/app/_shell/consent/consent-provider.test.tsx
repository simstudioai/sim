/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/_shell/consent/consent-store-provider', () => ({
  ConsentStoreProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid='store'>{children}</div>
  ),
}))
vi.mock('@/lib/consent/tracking-consent', () => ({
  TrackingConsentProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/app/_shell/consent/consent-banner', () => ({
  ConsentBanner: () => <span data-testid='banner' />,
}))
vi.mock('@/app/_shell/consent/google-analytics-page-view-tracker', () => ({
  GoogleAnalyticsPageViewTracker: () => <span data-testid='analytics' />,
}))

import { ConsentProvider } from '@/app/_shell/consent/consent-provider'

let root: Root | null = null

function render(): HTMLDivElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <ConsentProvider>
        <span data-testid='application' />
      </ConsentProvider>
    )
  )
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.clearAllMocks()
})

describe('ConsentProvider', () => {
  it('wraps the application and presents the policy-controlled consent surface', () => {
    const container = render()

    expect(container.querySelector('[data-testid="store"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="application"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="analytics"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="banner"]')).not.toBeNull()
  })
})
