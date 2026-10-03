/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCal,
  mockCalComponent,
  mockConsent,
  mockTheme,
  mockGetCalApi,
  mockTrackGoogleAdsConversion,
  mockTrackGoogleEvent,
} = vi.hoisted(() => ({
  mockCal: vi.fn(),
  mockCalComponent: vi.fn(() => null),
  mockConsent: { marketing: true, measurement: true },
  mockTheme: { resolvedTheme: 'light' },
  mockGetCalApi: vi.fn(),
  mockTrackGoogleAdsConversion: vi.fn(),
  mockTrackGoogleEvent: vi.fn(),
}))

vi.mock('next-themes', () => ({ useTheme: () => mockTheme }))

vi.mock('@calcom/embed-react', () => ({
  default: mockCalComponent,
  getCalApi: mockGetCalApi,
}))
vi.mock('@/lib/analytics/google', () => ({
  trackGoogleAdsConversion: mockTrackGoogleAdsConversion,
  trackGoogleEvent: mockTrackGoogleEvent,
}))
vi.mock('@/lib/consent/scripts', () => ({ X_DEMO_BOOKED_EVENT_ID: 'demo-booked' }))
vi.mock('@/lib/consent/tracking-consent', () => ({
  useTrackingConsent: () => mockConsent,
}))

import { DemoScheduler } from '@/app/(landing)/demo/components/demo-scheduler/demo-scheduler'

const LEAD = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  notes: 'Company: Analytical Engines\nTopic: Demo',
}

interface BookingRegistration {
  action: string
  callback: () => void
}

/** The listener the scheduler registered with the Cal.com embed, if any. */
function bookingRegistration(): BookingRegistration | undefined {
  return mockCal.mock.calls.find(([method]) => method === 'on')?.[1] as
    | BookingRegistration
    | undefined
}

describe('DemoScheduler', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    mockTheme.resolvedTheme = 'light'
    mockConsent.marketing = true
    mockConsent.measurement = true
    mockGetCalApi.mockResolvedValue(mockCal)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
      await Promise.resolve()
    })
    container.remove()
    window.twq = undefined
  })

  it('sends measurement analytics but no ad conversion without marketing consent', async () => {
    mockConsent.marketing = false
    const trackXEvent = vi.fn()
    window.twq = trackXEvent

    await act(async () => {
      root.render(<DemoScheduler lead={LEAD} />)
      await Promise.resolve()
    })

    bookingRegistration()?.callback()

    expect(mockTrackGoogleEvent).toHaveBeenCalledOnce()
    expect(mockTrackGoogleAdsConversion).not.toHaveBeenCalled()
    expect(trackXEvent).not.toHaveBeenCalled()
  })

  it('does not register booking analytics without measurement or marketing consent', async () => {
    mockConsent.marketing = false
    mockConsent.measurement = false

    await act(async () => {
      root.render(<DemoScheduler lead={LEAD} />)
      await Promise.resolve()
    })

    expect(mockCal).toHaveBeenCalledWith('ui', {
      theme: 'light',
      hideEventTypeDetails: true,
      styles: { branding: { brandColor: '#6f3dfa' } },
    })
    expect(bookingRegistration()).toBeUndefined()
  })
})
