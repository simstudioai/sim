/** @vitest-environment node */
import { expect, it, vi } from 'vitest'

vi.hoisted(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://dev.sim.ai')
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('MSHIP_PLAN_MODE', 'false')
  vi.stubEnv('MSHIP_MODEL_SELECTOR', 'false')
})
vi.unmock('@/lib/core/config/env')
vi.unmock('@/lib/core/config/env-flags')

import { isMothershipModelSelectorEnabled, isPlanModeEnabled } from '@/lib/core/config/env-flags'

it('honors an explicit Plan disable even in dev', () => {
  expect(isMothershipModelSelectorEnabled).toBe(false)
  expect(isPlanModeEnabled).toBe(false)
})
