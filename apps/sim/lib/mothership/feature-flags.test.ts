import { beforeEach, expect, it, vi } from 'vitest'

const config = vi.hoisted(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.dev.sim.ai')
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('APPCONFIG_APPLICATION', 'sim-dev')
  vi.stubEnv('APPCONFIG_ENVIRONMENT', 'dev')
  vi.stubEnv('MSHIP_MODEL_SELECTOR', 'true')
  return { document: {} as Record<string, { enabled: boolean }>, fetch: vi.fn() }
})
vi.unmock('@/lib/core/config/env')
vi.unmock('@/lib/core/config/env-flags')
vi.mock('@/lib/core/config/appconfig', () => ({ fetchAppConfigProfile: config.fetch }))

import { isMothershipModelSelectorEnabled } from '@/lib/mothership/feature-flags'

beforeEach(() => {
  config.document = {}
  config.fetch.mockImplementation((_ids, parse) => Promise.resolve(parse(config.document)))
})

it('reads the dev AppConfig values on the deployed www hostname', async () => {
  config.document = {
    'mothership-model-selector': { enabled: true },
  }
  expect(await isMothershipModelSelectorEnabled()).toBe(true)
  expect(config.fetch).toHaveBeenCalledWith(
    { application: 'sim-dev', environment: 'dev', profile: 'feature-flags' },
    expect.any(Function)
  )
})

it('does not enable absent flags from the hostname or fallback environment values', async () => {
  expect(await isMothershipModelSelectorEnabled()).toBe(false)
})

it('honors independent runtime flag changes without reloading the module', async () => {
  config.document = {
    'mothership-model-selector': { enabled: true },
  }
  expect(await isMothershipModelSelectorEnabled()).toBe(true)
  config.document = {
    'mothership-model-selector': { enabled: false },
  }
  expect(await isMothershipModelSelectorEnabled()).toBe(false)
})
