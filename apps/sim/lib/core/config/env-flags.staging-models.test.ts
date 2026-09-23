/** @vitest-environment node */
import { expect, it, vi } from 'vitest'

vi.hoisted(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://staging.sim.ai')
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('MSHIP_PLAN_MODE', undefined)
  vi.stubEnv('MSHIP_MODEL_SELECTOR', undefined)
})
vi.unmock('@/lib/core/config/env')
vi.unmock('@/lib/core/config/env-flags')

import { isMothershipModelSelectorEnabled, isPlanModeEnabled } from '@/lib/core/config/env-flags'

it('keeps model, Fast and Plan controls off by default in staging', () => {
  expect(isMothershipModelSelectorEnabled).toBe(false)
  expect(isPlanModeEnabled).toBe(false)
})
