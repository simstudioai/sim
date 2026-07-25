/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { PI_SANDBOX_MAX_LIFETIME_MS } from '@/lib/execution/remote-sandbox/pi-lifetime'
import {
  CLONE_TIMEOUT_MS,
  FINALIZE_TIMEOUT_MS,
  GIT_CONFIG_DIGEST_LINE,
  GIT_CONFIG_DIGEST_MARKER,
  PI_TIMEOUT_MS,
} from '@/executor/handlers/pi/cloud-shared'

describe('PI_TIMEOUT_MS', () => {
  it('leaves the host room to commit and push after the agent turn ends', () => {
    // Capping at the bare sandbox lifetime would mean the sandbox always died
    // first, taking the agent's finished work with it unpushed.
    expect(PI_TIMEOUT_MS).toBeLessThanOrEqual(
      PI_SANDBOX_MAX_LIFETIME_MS - CLONE_TIMEOUT_MS - FINALIZE_TIMEOUT_MS
    )
    expect(PI_TIMEOUT_MS).toBeGreaterThan(0)
  })
})

describe('GIT_CONFIG_DIGEST_LINE', () => {
  it('emits the marker a host parses, over the one config scope a root agent can write', () => {
    expect(GIT_CONFIG_DIGEST_LINE).toContain(GIT_CONFIG_DIGEST_MARKER)
    expect(GIT_CONFIG_DIGEST_LINE).toContain('.git/config')
    // A worktree config is not always present, and its absence must not fail the clone.
    expect(GIT_CONFIG_DIGEST_LINE).toContain('.git/config.worktree')
    expect(GIT_CONFIG_DIGEST_LINE).toContain('2>/dev/null')
  })
})
