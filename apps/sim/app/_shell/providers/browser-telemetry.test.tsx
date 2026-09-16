/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { session, consent, settings, start, stop } = vi.hoisted(() => {
  const stop = vi.fn()
  return {
    session: {
      data: null as { user: { id: string } } | null,
      isPending: true,
      error: null as Error | null,
    },
    consent: { isResolved: false, measurement: false },
    settings: { data: undefined as { telemetryEnabled: boolean } | undefined, isError: false },
    start: vi.fn(() => stop),
    stop,
  }
})

vi.mock('@/lib/auth/auth-client', () => ({ useSession: () => session }))
vi.mock('@/lib/consent/tracking-consent', () => ({ useTrackingConsent: () => consent }))
vi.mock('@/hooks/queries/general-settings', () => ({ useGeneralSettings: () => settings }))
vi.mock('@/lib/telemetry/browser', () => ({ startBrowserTelemetry: start }))

import { setBrowserTelemetryPreference } from '@/lib/telemetry/browser-preference'
import { BrowserTelemetry } from '@/app/_shell/providers/browser-telemetry'

let root: Root
let container: HTMLDivElement

function render(disabled = false, consentRequired = true) {
  act(() => root.render(<BrowserTelemetry disabled={disabled} consentRequired={consentRequired} />))
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  root = createRoot(container)
  localStorage.clear()
})

afterEach(() => {
  act(() => root.unmount())
  session.data = null
  session.isPending = true
  session.error = null
  consent.isResolved = false
  consent.measurement = false
  settings.data = undefined
  settings.isError = false
  setBrowserTelemetryPreference(true)
  localStorage.clear()
  vi.clearAllMocks()
})

describe('BrowserTelemetry permission boundary', () => {
  it('waits for consent and saved account settings, then stops on either withdrawal', () => {
    render()
    session.isPending = false
    session.data = { user: { id: 'user-1' } }
    render()
    consent.isResolved = true
    consent.measurement = true
    render()
    expect(start).not.toHaveBeenCalled()

    settings.data = { telemetryEnabled: false }
    render()
    expect(start).not.toHaveBeenCalled()
    settings.data.telemetryEnabled = true
    render()
    expect(start).toHaveBeenCalledTimes(1)
    settings.data.telemetryEnabled = false
    render()
    expect(stop).toHaveBeenCalledTimes(1)
    settings.data.telemetryEnabled = true
    render()
    consent.measurement = false
    render()
    expect(stop).toHaveBeenCalledTimes(2)
  })

  it('honors the deployment disable switch and does not require hosted consent when self-hosted', () => {
    session.isPending = false
    render(true, false)
    expect(start).not.toHaveBeenCalled()
    render(false, false)
    expect(start).toHaveBeenCalledTimes(1)
    render(true, false)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('keeps a saved browser refusal effective and observes local changes', () => {
    session.isPending = false
    consent.isResolved = true
    consent.measurement = true
    setBrowserTelemetryPreference(false)
    render()
    expect(start).not.toHaveBeenCalled()
    act(() => setBrowserTelemetryPreference(true))
    expect(start).toHaveBeenCalledTimes(1)
    act(() => setBrowserTelemetryPreference(false))
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('stops on session or settings errors even with previously allowed data', () => {
    session.isPending = false
    session.data = { user: { id: 'user-1' } }
    consent.isResolved = true
    consent.measurement = true
    settings.data = { telemetryEnabled: true }
    render()
    settings.isError = true
    render()
    expect(stop).toHaveBeenCalledTimes(1)
    settings.isError = false
    session.error = new Error('Session unavailable')
    render()
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('keeps newer Analytics withdrawals effective across restarts without reacting to Marketing', () => {
    session.isPending = false
    consent.isResolved = true
    consent.measurement = true
    render()
    const save = (measurement: boolean, marketing: boolean) => {
      const newValue = JSON.stringify({ consents: { measurement, marketing } })
      act(() => {
        localStorage.setItem('c15t', newValue)
        window.dispatchEvent(new StorageEvent('storage', { key: 'c15t', newValue }))
      })
    }
    save(true, false)
    expect(stop).not.toHaveBeenCalled()
    save(false, false)
    expect(stop).toHaveBeenCalledTimes(1)
    act(() => setBrowserTelemetryPreference(false))
    act(() => setBrowserTelemetryPreference(true))
    expect(start).toHaveBeenCalledTimes(1)
    act(() => {
      localStorage.clear()
      window.dispatchEvent(new StorageEvent('storage', { key: null }))
    })
    render()
    expect(start).toHaveBeenCalledTimes(1)
    save(true, false)
    expect(start).toHaveBeenCalledTimes(2)
  })
})
