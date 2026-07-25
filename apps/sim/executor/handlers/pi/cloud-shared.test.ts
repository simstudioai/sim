/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  PI_SANDBOX_MAX_LIFETIME_MS,
  PI_SANDBOX_MIN_LIFETIME_MS,
} from '@/lib/execution/remote-sandbox/pi-lifetime'
import {
  CLONE_TIMEOUT_MS,
  FINALIZE_TIMEOUT_MS,
  MIN_PI_TIMEOUT_MS,
  PI_TIMEOUT_MS,
} from '@/executor/handlers/pi/cloud-shared'

describe('PI_TIMEOUT_MS', () => {
  it('reserves every command budget that brackets the agent turn', () => {
    // Capping at the bare sandbox lifetime would mean the sandbox always died
    // first, taking the agent's finished work with it unpushed. Create PR runs
    // three bracketing commands, and the commit and the push each get the full
    // finalize budget — reserving only one of them leaves the push unbudgeted,
    // which is exactly when losing the sandbox costs the most.
    expect(PI_TIMEOUT_MS).toBeLessThanOrEqual(
      PI_SANDBOX_MAX_LIFETIME_MS - CLONE_TIMEOUT_MS - 2 * FINALIZE_TIMEOUT_MS
    )
    expect(PI_TIMEOUT_MS).toBeGreaterThan(0)
  })

  it('keeps the lifetime floor above the reserves it exists to protect', () => {
    // The floor lives next to the lifetime and the reserves live here, so
    // without this they can drift until a permitted lifetime leaves the agent
    // turn with nothing but its own minimum.
    expect(PI_SANDBOX_MIN_LIFETIME_MS).toBeGreaterThanOrEqual(
      CLONE_TIMEOUT_MS + 2 * FINALIZE_TIMEOUT_MS + MIN_PI_TIMEOUT_MS
    )
  })
})
