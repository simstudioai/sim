import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { resolvePlatformMode } from '@/platform/lib/data/mode'

/** Failure mode: a stray env serves example data, with no login, from a production build. */
describe('resolvePlatformMode', () => {
  it('never serves fixtures from a production build', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SIM_PLATFORM_FIXTURES', '1')
    expect(resolvePlatformMode()).toBe('live')
  })

  it('serves fixtures from the development server that opts in', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('SIM_PLATFORM_FIXTURES', '1')
    expect(resolvePlatformMode()).toBe('fixture')
  })

  it('serves live data from the development server by default', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('SIM_PLATFORM_FIXTURES', '')
    expect(resolvePlatformMode()).toBe('live')
  })
})
