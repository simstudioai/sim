import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { assertDeployableMode } from '@/platform/lib/data/mode'

/** Failure mode: a stray env serves fixtures or an ungated shell from a deployed zone. */
describe('assertDeployableMode', () => {
  const deployed = (env: Record<string, string>) => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SIM_PLATFORM_BASE_PATH', '/org')
    vi.stubEnv('SIM_PLATFORM_FIXTURES', '')
    vi.stubEnv('DATABASE_URL', '')
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  }

  it('refuses fixtures behind the base path, even with a database', () => {
    deployed({ SIM_PLATFORM_FIXTURES: '1', DATABASE_URL: 'postgresql://sim.example/sim' })
    expect(assertDeployableMode).toThrow('"fixture"')
  })

  it('refuses a missing database behind the base path', () => {
    deployed({})
    expect(assertDeployableMode).toThrow('"none"')
  })

  it('starts when live behind the base path', () => {
    deployed({ DATABASE_URL: 'postgresql://sim.example/sim' })
    expect(assertDeployableMode).not.toThrow()
  })

  it('leaves a local design session alone', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SIM_PLATFORM_BASE_PATH', '')
    vi.stubEnv('SIM_PLATFORM_FIXTURES', '1')
    expect(assertDeployableMode).not.toThrow()
  })
})
