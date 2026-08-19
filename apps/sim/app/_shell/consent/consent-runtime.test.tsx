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
    return <span data-testid='banner' />
  },
}))

import { ConsentRuntime } from '@/app/_shell/consent/consent-runtime'

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.clearAllMocks()
})

describe('ConsentRuntime', () => {
  it('mounts the banner against the hosted consent backend', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<ConsentRuntime />))

    expect(container.querySelector('[data-testid="banner"]')).not.toBeNull()
    expect(mockConsentBanner).toHaveBeenCalled()
    // `toMatchObject`, not exact equality: `DEV_CONSENT_COUNTRY` adds an
    // `overrides` key whenever a developer has NEXT_PUBLIC_CONSENT_COUNTRY set
    // locally, and the assertion is about the shipped configuration.
    expect(mockConsentManagerProvider.mock.calls[0]?.[0]).toMatchObject({
      mode: 'hosted',
      backendURL: 'https://sim-sim.inth.app',
      consentCategories: ['necessary', 'measurement', 'marketing'],
    })
  })
})
