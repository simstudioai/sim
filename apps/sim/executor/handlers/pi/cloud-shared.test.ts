/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { PI_SANDBOX_MAX_LIFETIME_MS } from '@/lib/execution/remote-sandbox/pi-lifetime'
import {
  CLONE_TIMEOUT_MS,
  FINALIZE_TIMEOUT_MS,
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
})
