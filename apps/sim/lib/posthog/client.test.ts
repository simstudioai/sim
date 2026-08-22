/**
 * @vitest-environment node
 */
import type { PostHog } from 'posthog-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

/** Lets the readiness promise and its continuations settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('captureClientEvent', () => {
  const posthog = createFakePostHog()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('holds an event captured before PostHog initializes, then sends it', async () => {
    captureClientEvent('login_page_viewed', {})
    await flush()

    expect(posthog.capture).not.toHaveBeenCalled()

    settlePostHogClient(posthog)
    await flush()

    expect(posthog.capture).toHaveBeenCalledWith('login_page_viewed', {})
  })

  it('sends events captured after initialization', async () => {
    captureClientEvent('signup_page_viewed', {})
    await flush()

    expect(posthog.capture).toHaveBeenCalledWith('signup_page_viewed', {})
  })

  it('reports a caught error through captureException so error tracking sees it', async () => {
    const error = new Error('canvas exploded')

    captureClientException(error, { error_boundary: 'workflow_canvas' })
    await flush()

    expect(posthog.captureException).toHaveBeenCalledWith(error, {
      error_boundary: 'workflow_canvas',
    })
  })
})

describe('captureClientEvent when analytics is disabled', () => {
  it('drops events without throwing once the provider settles with null', async () => {
    vi.resetModules()
    const client = await import('@/lib/posthog/client')

    client.captureClientEvent('login_page_viewed', {})
    client.captureClientException(new Error('boom'))
    client.settlePostHogClient(null)

    await expect(flush()).resolves.toBeUndefined()
  })
})
