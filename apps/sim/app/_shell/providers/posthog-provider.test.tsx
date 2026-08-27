/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { consent, mockCapture, mockInit, mockOptIn, mockOptOut, mockPostHog, mockSetPostHogClient } =
  vi.hoisted(() => {
    const posthog = {
      __loaded: false,
      capture: vi.fn(),
      init: vi.fn(),
      opt_in_capturing: vi.fn(),
      opt_out_capturing: vi.fn(),
    }
    posthog.init.mockImplementation(() => {
      posthog.__loaded = true
    })
    return {
      consent: { isResolved: false, measurement: false, marketing: false },
      mockCapture: posthog.capture,
      mockInit: posthog.init,
      mockOptIn: posthog.opt_in_capturing,
      mockOptOut: posthog.opt_out_capturing,
      mockPostHog: posthog,
      mockSetPostHogClient: vi.fn(),
    }
  })

vi.mock('@/lib/consent/tracking-consent', () => ({ useTrackingConsent: () => consent }))
vi.mock('@/lib/core/config/env', () => ({
  getEnv: (name: string) =>
    name === 'NEXT_PUBLIC_POSTHOG_ENABLED' ? 'true' : 'phc_test_project_key',
  isTruthy: (value: string) => value === 'true',
  publicEnvMissingAtModuleInit: false,
}))
vi.mock('@/lib/posthog/client', () => ({ setPostHogClient: mockSetPostHogClient }))
vi.mock('@/lib/posthog/exception-filter', () => ({ preparePostHogEvent: vi.fn() }))
vi.mock('posthog-js', () => ({
  default: mockPostHog,
}))
vi.mock('posthog-js/react', () => ({
  PostHogProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='posthog-provider'>{children}</div>
  ),
}))

import { PostHogProvider } from '@/app/_shell/providers/posthog-provider'

let root: Root | null = null
let container: HTMLDivElement | null = null

function render(): HTMLDivElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container ??= document.createElement('div')
  document.body.appendChild(container)
  root ??= createRoot(container)
  act(() =>
    root?.render(
      <PostHogProvider consentRequired>
        <span data-testid='application' />
      </PostHogProvider>
    )
  )
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container = null
  consent.isResolved = false
  consent.measurement = false
  mockPostHog.__loaded = false
  localStorage.clear()
  sessionStorage.clear()
  vi.clearAllMocks()
})

describe('PostHogProvider consent gating', () => {
  it('initializes and publishes PostHog only while measurement consent is granted', async () => {
    localStorage.setItem('ph_phc_test_project_key_posthog', 'identity')
    localStorage.setItem('ph_other_project_posthog', 'other-identity')
    localStorage.setItem('application_preference', 'keep')
    const container = render()
    const application = container.querySelector('[data-testid="application"]')

    expect(mockInit).not.toHaveBeenCalled()
    expect(localStorage.getItem('ph_phc_test_project_key_posthog')).toBe('identity')
    expect(application).not.toBeNull()
    expect(container.querySelector('[data-testid="posthog-provider"]')).not.toBeNull()

    consent.isResolved = true
    consent.measurement = true
    render()

    await vi.waitFor(() => expect(mockInit).toHaveBeenCalledTimes(1))
    expect(mockInit).toHaveBeenCalledWith(
      'phc_test_project_key',
      expect.objectContaining({
        opt_out_capturing_by_default: true,
        opt_out_persistence_by_default: true,
      })
    )
    expect(mockOptIn).toHaveBeenCalledWith({ captureEventName: false })
    expect(mockSetPostHogClient).toHaveBeenLastCalledWith(
      expect.objectContaining({ capture: mockCapture })
    )
    expect(container.querySelector('[data-testid="posthog-provider"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="application"]')).toBe(application)

    consent.measurement = false
    render()

    expect(mockOptOut).toHaveBeenCalledTimes(1)
    expect(mockSetPostHogClient).toHaveBeenLastCalledWith(null)
    expect(container.querySelector('[data-testid="posthog-provider"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="application"]')).toBe(application)
    expect(localStorage.getItem('ph_phc_test_project_key_posthog')).toBeNull()
    expect(localStorage.getItem('ph_other_project_posthog')).toBe('other-identity')
    expect(localStorage.getItem('application_preference')).toBe('keep')
  })

  it('clears only this project persistence after an initial denial', () => {
    localStorage.setItem('ph_phc_test_project_key_posthog', 'identity')
    localStorage.setItem('__ph_opt_in_out_phc_test_project_key', '1')
    sessionStorage.setItem('ph_phc_test_project_key_window_id', 'window-id')
    localStorage.setItem('ph_other_project_posthog', 'other-identity')

    render()
    consent.isResolved = true
    render()

    expect(mockInit).not.toHaveBeenCalled()
    expect(localStorage.getItem('ph_phc_test_project_key_posthog')).toBeNull()
    expect(localStorage.getItem('__ph_opt_in_out_phc_test_project_key')).toBeNull()
    expect(sessionStorage.getItem('ph_phc_test_project_key_window_id')).toBeNull()
    expect(localStorage.getItem('ph_other_project_posthog')).toBe('other-identity')
  })
})
