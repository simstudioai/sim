/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://self-hosted.example')
  vi.stubEnv('NEXT_PUBLIC_FORCE_HOSTED', 'true')
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubGlobal('window', { location: { hostname: 'www.sim.ai' } })
})

vi.unmock('@/lib/core/config/env')
vi.unmock('@/lib/core/config/env-flags')

import { isHosted, isProd } from '@/lib/core/config/env-flags'

describe('configured hosted detection', () => {
  it('preserves a configured self-hosted URL and ignores the development override in production', () => {
    expect(isProd).toBe(true)
    expect(isHosted).toBe(false)
  })
})
