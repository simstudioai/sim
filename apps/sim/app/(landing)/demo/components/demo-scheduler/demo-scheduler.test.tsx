/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCal, mockCalComponent, mockConsent, mockGetCalApi, mockTrackGoogleEvent } = vi.hoisted(
  () => ({
    mockCal: vi.fn(),
    mockCalComponent: vi.fn(() => null),
    mockConsent: { marketing: true, measurement: true },
    mockGetCalApi: vi.fn(),
    mockTrackGoogleEvent: vi.fn(),
  })
)

vi.mock('@calcom/embed-react', () => ({
  default: mockCalComponent,
  getCalApi: mockGetCalApi,
}))
vi.mock('@/lib/analytics/google', () => ({ trackGoogleEvent: mockTrackGoogleEvent }))
vi.mock('@/lib/consent/scripts', () => ({ X_DEMO_BOOKED_EVENT_ID: 'demo-booked' }))
vi.mock('@/lib/consent/tracking-consent', () => ({
  useTrackingConsent: () => mockConsent,
}))

import {
  DemoScheduler,
  preloadCalEmbed,
} from '@/app/(landing)/demo/components/demo-scheduler/demo-scheduler'

const LEAD = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  notes: 'Company: Analytical Engines\nTopic: Demo',
}

describe('DemoScheduler', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
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

  it('passes the main-branch presentation and lead config to the official embed', async () => {
    await act(async () => {
      root.render(<DemoScheduler lead={LEAD} />)
      await Promise.resolve()
    })

    expect(mockCalComponent).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'demo',
        calLink: 'team/sim/demo',
        style: { width: '100%', height: '100%', overflow: 'auto' },
        config: {
          name: LEAD.name,
          email: LEAD.email,
          notes: LEAD.notes,
          theme: 'light',
          'ui.color-scheme': 'light',
          layout: 'month_view',
          useSlotsViewOnSmallScreen: 'true',
        },
      }),
      undefined
    )
    expect(mockCal).toHaveBeenCalledWith('ui', {
      hideEventTypeDetails: true,
      styles: { branding: { brandColor: '#6f3dfa' } },
    })
  })

  it('registers consent-aware booking analytics and removes the listener on unmount', async () => {
    const trackXEvent = vi.fn()
    window.twq = trackXEvent

    await act(async () => {
      root.render(<DemoScheduler lead={LEAD} />)
      await Promise.resolve()
    })

    const registration = mockCal.mock.calls.find(([method]) => method === 'on')?.[1] as
      | { action: string; callback: () => void }
      | undefined
    expect(registration?.action).toBe('bookingSuccessfulV2')

    registration?.callback()
    expect(mockTrackGoogleEvent).toHaveBeenCalledWith('get_a_demo', {
      page_path: '/demo',
      form_name: 'sim_demo',
      booking_status: 'scheduled',
    })
    expect(trackXEvent).toHaveBeenCalledWith('event', 'demo-booked', {})

    await act(async () => {
      root.unmount()
      await Promise.resolve()
    })
    expect(mockCal).toHaveBeenCalledWith('off', {
      action: 'bookingSuccessfulV2',
      callback: registration?.callback,
    })
    root = createRoot(container)
  })

  it('does not register booking analytics without measurement or marketing consent', async () => {
    mockConsent.marketing = false
    mockConsent.measurement = false

    await act(async () => {
      root.render(<DemoScheduler lead={LEAD} />)
      await Promise.resolve()
    })

    expect(mockCal).toHaveBeenCalledWith('ui', {
      hideEventTypeDetails: true,
      styles: { branding: { brandColor: '#6f3dfa' } },
    })
    expect(mockCal.mock.calls.some(([method]) => method === 'on')).toBe(false)
  })

  it('preloads the configured booker only once', async () => {
    await act(async () => {
      preloadCalEmbed()
      preloadCalEmbed()
      await Promise.resolve()
    })

    expect(mockGetCalApi).toHaveBeenCalledOnce()
    expect(mockGetCalApi).toHaveBeenCalledWith({ namespace: 'demo' })
    expect(mockCal).toHaveBeenCalledOnce()
    expect(mockCal).toHaveBeenCalledWith('preload', { calLink: 'team/sim/demo' })
  })
})
