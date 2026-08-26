/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { consent, navigation, mockTrackGooglePageView } = vi.hoisted(() => ({
  consent: { hasFetchedBanner: false, measurement: false, gtagLoaded: false },
  navigation: { pathname: '/pricing' },
  mockTrackGooglePageView: vi.fn(),
}))

vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }))
vi.mock('@c15t/nextjs/headless', () => ({
  useConsentManager: () => ({
    has: (category: string) => category === 'measurement' && consent.measurement,
    hasFetchedBanner: consent.hasFetchedBanner,
    loadedScripts: { gtag: consent.gtagLoaded },
  }),
}))
vi.mock('@/lib/analytics/google', () => ({
  trackGooglePageView: mockTrackGooglePageView,
}))

import { GoogleAnalyticsPageViewTracker } from '@/app/_shell/consent/google-analytics-page-view-tracker'

let root: Root | null = null

function render(): void {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  if (!root) root = createRoot(document.createElement('div'))
  act(() => root?.render(<GoogleAnalyticsPageViewTracker />))
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  consent.hasFetchedBanner = false
  consent.measurement = false
  consent.gtagLoaded = false
  navigation.pathname = '/pricing'
  vi.clearAllMocks()
})

describe('GoogleAnalyticsPageViewTracker', () => {
  it('tracks only later path changes after consent and the automatic first view', () => {
    render()
    expect(mockTrackGooglePageView).not.toHaveBeenCalled()

    consent.hasFetchedBanner = true
    consent.measurement = true
    consent.gtagLoaded = true
    render()
    expect(mockTrackGooglePageView).not.toHaveBeenCalled()

    navigation.pathname = '/demo'
    render()
    render()

    expect(mockTrackGooglePageView).toHaveBeenCalledOnce()
    expect(mockTrackGooglePageView).toHaveBeenCalledWith('/demo')
  })
})
