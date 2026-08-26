/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { captureClientEvent, captureClientException, setPostHogClient } from '@/lib/posthog/client'

describe('client capture when analytics is disabled', () => {
  it('drops events instead of sending them, without throwing', () => {
    setPostHogClient(null)

    expect(() => captureClientEvent('login_page_viewed', {})).not.toThrow()
    expect(() => captureClientException(new Error('boom'))).not.toThrow()
  })
})
