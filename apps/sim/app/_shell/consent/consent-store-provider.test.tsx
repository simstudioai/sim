/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockConsentManagerProvider } = vi.hoisted(() => ({ mockConsentManagerProvider: vi.fn() }))

vi.mock('@c15t/nextjs/headless', () => ({
  ConsentManagerProvider: (props: { children: ReactNode; options: unknown }) => {
    mockConsentManagerProvider(props.options)
    return props.children
  },
}))

import { ConsentStoreProvider } from '@/app/_shell/consent/consent-store-provider'

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.clearAllMocks()
})

describe('ConsentStoreProvider', () => {
  it('configures the hosted consent backend with the iframe blocker off', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() =>
      root?.render(
        <ConsentStoreProvider>
          <span data-testid='child' />
        </ConsentStoreProvider>
      )
    )

    expect(container.querySelector('[data-testid="child"]')).not.toBeNull()
    // `toMatchObject`, not exact equality: `DEV_CONSENT_COUNTRY` adds an
    // `overrides` key whenever a developer has NEXT_PUBLIC_CONSENT_COUNTRY set
    // locally, and the assertion is about the shipped configuration.
    expect(mockConsentManagerProvider.mock.calls[0]?.[0]).toMatchObject({
      mode: 'hosted',
      backendURL: 'https://sim-sim.inth.app',
      consentCategories: ['necessary', 'measurement', 'marketing'],
      scripts: [
        expect.objectContaining({ id: 'gtag', category: 'measurement', alwaysLoad: true }),
        expect.objectContaining({ id: 'ahrefs-analytics', category: 'measurement' }),
      ],
      store: {
        storageConfig: { defaultExpiryDays: 365 },
        reloadOnConsentRevoked: true,
        iframeBlockerConfig: { disableAutomaticBlocking: true },
      },
    })
  })
})
