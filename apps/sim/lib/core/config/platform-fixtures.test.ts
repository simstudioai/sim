import { describe, expect, it, vi } from 'vitest'

/** What the app's build inlines as `process.env.SIM_PLATFORM_FIXTURES`. */
async function inlinedFixtureSwitch() {
  vi.resetModules()
  const { default: config } = await import('@/next.config')
  return config.env?.SIM_PLATFORM_FIXTURES
}

/**
 * Failure modes: example data, which renders with no sign-in, reaches a normal build; a normal
 * build leaves the switch to the environment of the server that runs it; a production image
 * carries a fixture build.
 */
describe('the fixture build switch', () => {
  it('inlines off into a normal build, so no server environment can turn it on', async () => {
    vi.stubEnv('SIM_PLATFORM_FIXTURES', undefined)
    expect(await inlinedFixtureSwitch()).toBe('')
  })

  it('inlines on only for a build that asked for fixtures exactly', async () => {
    vi.stubEnv('SIM_PLATFORM_FIXTURES', 'true')
    expect(await inlinedFixtureSwitch()).toBe('')
    vi.stubEnv('SIM_PLATFORM_FIXTURES', '1')
    expect(await inlinedFixtureSwitch()).toBe('1')
  })

  it('refuses a fixture build for a production image', async () => {
    vi.stubEnv('DOCKER_BUILD', 'true')
    vi.stubEnv('SIM_PLATFORM_FIXTURES', '1')
    await expect(inlinedFixtureSwitch()).rejects.toThrow(/production image/)
    vi.stubEnv('SIM_PLATFORM_FIXTURES', undefined)
    expect(await inlinedFixtureSwitch()).toBe('')
  })
})
