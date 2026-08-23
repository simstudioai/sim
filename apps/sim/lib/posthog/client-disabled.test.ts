/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  captureClientEvent,
  captureClientException,
  settlePostHogClient,
} from '@/lib/posthog/client'

/**
 * Lives in its own file because readiness is module-level and settles once.
 * Vitest isolates the module registry per file, so this gets an unsettled gate
 * to settle with `null` without `vi.resetModules()` and a dynamic import.
 */
describe('client capture when analytics is disabled', () => {
  it('drops events instead of sending them, without throwing', async () => {
    settlePostHogClient(null)

    expect(() => captureClientEvent('login_page_viewed', {})).not.toThrow()
    expect(() => captureClientException(new Error('boom'))).not.toThrow()

    // Lets the gate's continuations run; a missing catch would surface here as
    // an unhandled rejection and fail the test.
    await Promise.resolve()
  })
})
