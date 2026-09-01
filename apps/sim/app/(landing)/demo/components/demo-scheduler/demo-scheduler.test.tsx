/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockConsent, mockTrackGoogleEvent } = vi.hoisted(() => ({
  mockConsent: { marketing: true, measurement: true },
  mockTrackGoogleEvent: vi.fn(),
}))

vi.mock('@/lib/analytics/google', () => ({ trackGoogleEvent: mockTrackGoogleEvent }))
vi.mock('@/lib/consent/scripts', () => ({ X_DEMO_BOOKED_EVENT_ID: 'demo-booked' }))
vi.mock('@/lib/consent/tracking-consent', () => ({
  useTrackingConsent: () => mockConsent,
}))

import {
  createCalEmbedUrl,
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
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.querySelectorAll('iframe[hidden]').forEach((frame) => {
      frame.remove()
    })
    window.twq = undefined
  })

  function renderScheduler(): HTMLIFrameElement {
    act(() => root.render(<DemoScheduler lead={LEAD} />))
    const frame = container.querySelector<HTMLIFrameElement>('iframe[title="Book a demo"]')
    if (!frame) throw new Error('Expected the Cal booking iframe to render')
    return frame
  }

  it('builds the hosted embed URL with the lead and presentation prefilled', () => {
    const url = new URL(createCalEmbedUrl(LEAD))

    expect(url.origin).toBe('https://app.cal.com')
    expect(url.pathname).toBe('/team/sim/demo/embed')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      embed: 'demo',
      name: LEAD.name,
      email: LEAD.email,
      notes: LEAD.notes,
      theme: 'light',
      'ui.color-scheme': 'light',
      layout: 'month_view',
      useSlotsViewOnSmallScreen: 'true',
    })
  })

  it('warms the hosted booker only once while the preload frame remains mounted', () => {
    preloadCalEmbed()
    preloadCalEmbed()

    const frames = document.querySelectorAll<HTMLIFrameElement>('iframe[hidden]')
    expect(frames).toHaveLength(1)
    expect(frames[0].src).toBe('https://app.cal.com/team/sim/demo?preload=true')
  })

  it('tracks a booking only when the message comes from the rendered Cal iframe', () => {
    const trackXEvent = vi.fn()
    window.twq = trackXEvent
    const frame = renderScheduler()
    const frameWindow = frame.contentWindow
    expect(frameWindow).not.toBeNull()

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://malicious.example',
          source: frameWindow,
          data: { fullType: 'CAL:demo:bookingSuccessfulV2' },
        })
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://app.cal.com',
          source: frameWindow,
          data: { fullType: 'CAL:demo:bookingSuccessfulV2' },
        })
      )
    })

    expect(mockTrackGoogleEvent).toHaveBeenCalledOnce()
    expect(mockTrackGoogleEvent).toHaveBeenCalledWith('get_a_demo', {
      page_path: '/demo',
      form_name: 'sim_demo',
      booking_status: 'scheduled',
    })
    expect(trackXEvent).toHaveBeenCalledOnce()
    expect(trackXEvent).toHaveBeenCalledWith('event', 'demo-booked', {})
  })

  it("completes Cal's ready handshake and reapplies the branded UI settings", () => {
    const frame = renderScheduler()
    const frameWindow = frame.contentWindow
    expect(frameWindow).not.toBeNull()
    if (!frameWindow) return
    const postMessage = vi.spyOn(frameWindow, 'postMessage')

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://app.cal.com',
          source: frameWindow,
          data: { fullType: 'CAL:demo:__iframeReady' },
        })
      )
    })

    expect(postMessage).toHaveBeenNthCalledWith(
      1,
      { originator: 'CAL', method: 'parentKnowsIframeReady' },
      'https://app.cal.com'
    )
    expect(postMessage).toHaveBeenNthCalledWith(
      2,
      {
        originator: 'CAL',
        method: 'ui',
        arg: {
          hideEventTypeDetails: true,
          styles: { branding: { brandColor: '#6f3dfa' } },
        },
      },
      'https://app.cal.com'
    )
  })
})
