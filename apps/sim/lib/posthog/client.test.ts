/**
 * @vitest-environment node
 */
import type { PostHog } from 'posthog-js'
import { describe, expect, it, vi } from 'vitest'
import {
  captureClientEvent,
  captureClientException,
  settlePostHogClient,
} from '@/lib/posthog/client'

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
  /**
   * Readiness is module-level and settles exactly once, so the whole lifecycle
   * runs as a single case. Split across separate cases, each one after the
   * first would silently depend on an earlier case having settled the gate, and
   * would fail when run in isolation or reordered.
   */
  it('holds events until PostHog initializes, then sends them and everything after', async () => {
    const posthog = createFakePostHog()

    captureClientEvent('login_page_viewed', {})
    await Promise.resolve()

    expect(posthog.capture).not.toHaveBeenCalled()

    settlePostHogClient(posthog)
    await vi.waitFor(() => expect(posthog.capture).toHaveBeenCalledWith('login_page_viewed', {}))

    captureClientEvent('signup_page_viewed', {})
    await vi.waitFor(() => expect(posthog.capture).toHaveBeenCalledWith('signup_page_viewed', {}))

    const error = new Error('canvas exploded')
    captureClientException(error, { error_boundary: 'workflow_canvas' })
    await vi.waitFor(() =>
      expect(posthog.captureException).toHaveBeenCalledWith(error, {
        error_boundary: 'workflow_canvas',
      })
    )
  })
})
