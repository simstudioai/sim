import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { assertDeployableMode } from '@/platform/lib/data/mode'

/** Failure mode: a stray env serves fixtures or an ungated shell from a deployed zone. */
describe('assertDeployableMode', () => {
  afterEach(() => vi.unstubAllEnvs())

  const deployed = (env: Record<string, string>) => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SIM_PLATFORM_BASE_PATH', '/org')
    vi.stubEnv('SIM_PLATFORM_FIXTURES', '')
    vi.stubEnv('SIM_PLATFORM_API_ORIGIN', '')
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  }

  it('refuses fixtures behind the base path, even with an API origin', () => {
    deployed({ SIM_PLATFORM_FIXTURES: '1', SIM_PLATFORM_API_ORIGIN: 'https://sim.example' })
    expect(assertDeployableMode).toThrow('"fixture"')
  })

  it('refuses a missing API origin behind the base path', () => {
    deployed({})
    expect(assertDeployableMode).toThrow('"none"')
  })

  it('starts when live behind the base path', () => {
    deployed({ SIM_PLATFORM_API_ORIGIN: 'https://sim.example' })
    expect(assertDeployableMode).not.toThrow()
  })

  it('leaves a local design session alone', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SIM_PLATFORM_BASE_PATH', '')
    vi.stubEnv('SIM_PLATFORM_FIXTURES', '1')
    expect(assertDeployableMode).not.toThrow()
  })
})
