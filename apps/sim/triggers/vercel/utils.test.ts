/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { vercelHandler } from '@/lib/webhooks/providers/vercel'
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

describe('vercelHandler.formatInput', () => {
  it('passes through documented deployment links, regions, meta, and domain.delegated', async () => {
    const { input } = await vercelHandler.formatInput!({
      webhook: {},
      workflow: { id: 'w', userId: 'u' },
      body: {
        type: 'deployment.created',
        id: 'evt_1',
        createdAt: 1_700_000_000_000,
        region: 'iad1',
        payload: {
          deployment: {
            id: 'd1',
            url: 'https://x.vercel.app',
            name: 'x',
            meta: { k: 'v' },
          },
          links: { deployment: 'https://vercel.com/d', project: 'https://vercel.com/p' },
          regions: ['iad1', 'sfo1'],
          domain: { name: 'example.com', delegated: true },
        },
      },
      headers: {},
      requestId: 't',
    })
    const i = input as Record<string, unknown>
    expect(i.links).toEqual({
      deployment: 'https://vercel.com/d',
      project: 'https://vercel.com/p',
    })
    expect(i.regions).toEqual(['iad1', 'sfo1'])
    expect(i.deployment).toMatchObject({
      id: 'd1',
      meta: { k: 'v' },
    })
    expect(i.domain).toMatchObject({ name: 'example.com', delegated: true })
  })
})
