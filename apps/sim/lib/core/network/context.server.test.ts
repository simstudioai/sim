/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'

const { resolve } = vi.hoisted(() => ({
  resolve: vi.fn(async (organizationId: string | null | undefined) => ({
    kind: 'direct',
    organizationId,
  })),
}))
vi.mock('@/lib/core/network/config.server', () => ({ resolveOutboundRoute: resolve }))

import {
  resolveCurrentOutboundRoute,
  runWithOutboundOrganization,
} from '@/lib/core/network/context.server'

describe('outbound execution context', () => {
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
