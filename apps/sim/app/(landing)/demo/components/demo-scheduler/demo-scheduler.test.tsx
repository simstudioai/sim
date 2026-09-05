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

import {
  DemoScheduler,
  preloadCalEmbed,
  resolveCalEmbedConfig,
} from '@/app/(landing)/demo/components/demo-scheduler/demo-scheduler'

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
    vi.clearAllMocks()
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

  it('passes the current theme and lead config to the official embed', async () => {
    await act(async () => {
      root.render(<DemoScheduler lead={LEAD} />)
      await Promise.resolve()
    })

    expect(mockCalComponent).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'demo',
        calLink: 'team/sim/demo',
        calOrigin: 'https://app.cal.com',
        embedJsUrl: 'https://app.cal.com/embed/embed.js',
        className: 'size-full overflow-auto',
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
      theme: 'light',
      hideEventTypeDetails: true,
      styles: { branding: { brandColor: '#6f3dfa' } },
    })
  })

  it('updates the embed when the visitor switches to dark mode', async () => {
    await act(async () => {
      root.render(<DemoScheduler lead={LEAD} />)
    })
    mockTheme.resolvedTheme = 'dark'
    await act(async () => {
      root.render(<DemoScheduler lead={LEAD} />)
    })

    expect(mockCalComponent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ theme: 'dark', 'ui.color-scheme': 'dark' }),
      }),
      undefined
    )
    expect(mockCal).toHaveBeenCalledWith('ui', expect.objectContaining({ theme: 'dark' }))
  })

  it('registers consent-aware booking analytics and removes the listener on unmount', async () => {
    const trackXEvent = vi.fn()
    window.twq = trackXEvent

    await act(async () => {
      root.render(<DemoScheduler lead={LEAD} />)
      await Promise.resolve()
    })

    const registration = bookingRegistration()
    expect(registration?.action).toBe('bookingSuccessfulV2')

    registration?.callback()
    expect(mockTrackGoogleEvent).toHaveBeenCalledWith('get_a_demo', {
      page_path: '/demo',
      form_name: 'sim_demo',
      booking_status: 'scheduled',
    })
    expect(mockTrackGoogleAdsConversion).toHaveBeenCalledWith('demo_booked')
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

  it('preloads the configured booker only once', async () => {
    await act(async () => {
      preloadCalEmbed()
      preloadCalEmbed()
      await Promise.resolve()
    })

    expect(mockGetCalApi).toHaveBeenCalledOnce()
    expect(mockGetCalApi).toHaveBeenCalledWith({
      namespace: 'demo',
      embedJsUrl: 'https://app.cal.com/embed/embed.js',
    })
    expect(mockCal).toHaveBeenCalledOnce()
    expect(mockCal).toHaveBeenCalledWith('preload', { calLink: 'team/sim/demo' })
  })

  it('falls back from malformed Cal configuration and preserves valid custom origins', () => {
    expect(resolveCalEmbedConfig('javascript:alert(1)')).toEqual({
      calLink: 'team/sim/demo',
      calOrigin: 'https://app.cal.com',
      embedJsUrl: 'https://app.cal.com/embed/embed.js',
    })
    expect(resolveCalEmbedConfig('https://book.example.com/team/demo?theme=light#ignored')).toEqual(
      {
        calLink: 'team/demo?theme=light',
        calOrigin: 'https://book.example.com',
        embedJsUrl: 'https://book.example.com/embed/embed.js',
      }
    )
  })
})
