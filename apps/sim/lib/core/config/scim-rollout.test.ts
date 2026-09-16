/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.sim.ai')
  vi.stubEnv('BILLING_ENABLED', 'true')
  vi.stubEnv('ENTERPRISE_ENABLED', 'true')
  vi.stubEnv('SCIM_ENABLED', 'false')
})

vi.unmock('@/lib/core/config/env')
vi.unmock('@/lib/core/config/env-flags')

import { isHosted, isScimEnabled } from '@/lib/core/config/env-flags'

describe('SCIM rollout', () => {
  it('allows hosted deployments to defer provisioning until older app instances are drained', () => {
    expect(isHosted).toBe(true)
    expect(isScimEnabled).toBe(false)
  })
})
