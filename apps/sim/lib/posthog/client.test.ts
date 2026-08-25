/**
 * @vitest-environment node
 */
import type { PostHog } from 'posthog-js'
import { describe, expect, it, vi } from 'vitest'
import { captureClientEvent, captureClientException, setPostHogClient } from '@/lib/posthog/client'

/**
 * Stands in for the initialized singleton. `capture` exists on the real
 * instance long before `init` runs, which is what made the dropped-event bug
 * invisible to a `typeof posthog.capture === 'function'` guard.
 */
function createFakePostHog() {
  return {
    capture: vi.fn(),
    captureException: vi.fn(),
  } as unknown as PostHog
}

describe('client capture', () => {
  it('drops pre-consent events and captures only while a client is published', () => {
    const posthog = createFakePostHog()

    captureClientEvent('login_page_viewed', {})
    expect(posthog.capture).not.toHaveBeenCalled()

    setPostHogClient(posthog)
    captureClientEvent('signup_page_viewed', {})
    expect(posthog.capture).toHaveBeenCalledWith('signup_page_viewed', {})

    const error = new Error('canvas exploded')
    captureClientException(error, { error_boundary: 'workflow_canvas' })
    expect(posthog.captureException).toHaveBeenCalledWith(error, {
      error_boundary: 'workflow_canvas',
    })

    setPostHogClient(null)
    captureClientEvent('login_page_viewed', {})
    expect(posthog.capture).toHaveBeenCalledTimes(1)
  })
})
