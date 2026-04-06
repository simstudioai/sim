/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isVercelEventMatch } from '@/triggers/vercel/utils'

describe('isVercelEventMatch', () => {
  it('matches specialized triggers to Vercel type strings', () => {
    expect(isVercelEventMatch('vercel_deployment_created', 'deployment.created')).toBe(true)
    expect(isVercelEventMatch('vercel_deployment_created', 'deployment.ready')).toBe(false)
  })

  it('does not match unknown trigger ids', () => {
    expect(isVercelEventMatch('vercel_unknown_trigger', 'deployment.created')).toBe(false)
  })

  it('allows any event type for the curated generic trigger id', () => {
    expect(isVercelEventMatch('vercel_webhook', 'deployment.succeeded')).toBe(true)
    expect(isVercelEventMatch('vercel_webhook', undefined)).toBe(true)
  })
})
