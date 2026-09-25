import { describe, expect, it, vi } from 'vitest'

const { resolve } = vi.hoisted(() => ({
  resolve: vi.fn(async (organizationId: string | null | undefined) => ({
    kind: 'direct',
    organizationId,
  })),
}))
vi.mock('@/lib/core/network/config.server', () => ({
  resolveOutboundRoute: resolve,
  isOutboundRoutingEnabled: () => true,
}))

import {
  captureOutboundScope,
  resolveCurrentOutboundRoute,
  runWithOutboundOrganization,
} from '@/lib/core/network/context.server'

describe('outbound execution context', () => {
  it('restores captured ownership inside a callback invoked by another organization', async () => {
    const captured = runWithOutboundOrganization('org_a', captureOutboundScope)
    await runWithOutboundOrganization('org_b', async () => {
      expect(await captured(resolveCurrentOutboundRoute)).toEqual({
        kind: 'direct',
        organizationId: 'org_a',
      })
      expect(await resolveCurrentOutboundRoute()).toEqual({
        kind: 'direct',
        organizationId: 'org_b',
      })
    })
  })

  it('does not borrow ambient ownership when a callback captured no scope', async () => {
    const captured = captureOutboundScope()
    await runWithOutboundOrganization('org_a', async () => {
      expect(await captured(resolveCurrentOutboundRoute)).toEqual({
        kind: 'direct',
        organizationId: undefined,
      })
    })
  })

  it('isolates interleaved organizations and restores the parent after nested calls', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((done) => {
      release = done
    })
    const first = runWithOutboundOrganization('org_a', async () => {
      await gate
      await resolveCurrentOutboundRoute()
      await runWithOutboundOrganization('org_child', resolveCurrentOutboundRoute)
      return resolveCurrentOutboundRoute()
    })
    const second = runWithOutboundOrganization('org_b', async () => {
      await resolveCurrentOutboundRoute()
      release()
      return resolveCurrentOutboundRoute()
    })
    expect(await Promise.all([first, second])).toEqual([
      { kind: 'direct', organizationId: 'org_a' },
      { kind: 'direct', organizationId: 'org_b' },
    ])
    expect(await resolveCurrentOutboundRoute()).toEqual({
      kind: 'direct',
      organizationId: undefined,
    })
  })
})
