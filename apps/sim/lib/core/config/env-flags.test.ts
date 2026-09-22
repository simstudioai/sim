/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://self-hosted.example')
  vi.stubEnv('NEXT_PUBLIC_FORCE_HOSTED', 'true')
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('MSHIP_PLAN_MODE', 'true')
})

vi.unmock('@/lib/core/config/env')
vi.unmock('@/lib/core/config/env-flags')

import { isHosted, isPlanModeEnabled, isProd } from '@/lib/core/config/env-flags'

describe('hosted detection', () => {
  it('follows the configured URL and ignores the development override in production', () => {
    expect(isProd).toBe(true)
    expect(isHosted).toBe(false)
  })
})

describe('Plan mode deployment flag', () => {
  it('normalizes the runtime string to the boolean required by mode selectors', () => {
    expect(isPlanModeEnabled).toBe(true)
  })
})
