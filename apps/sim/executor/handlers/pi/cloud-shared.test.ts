/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  PI_SANDBOX_MAX_LIFETIME_MS,
  PI_SANDBOX_MIN_LIFETIME_MS,
} from '@/lib/execution/remote-sandbox/pi-lifetime'
import {
  buildPiScript,
  CLONE_TIMEOUT_MS,
  FINALIZE_TIMEOUT_MS,
  MIN_PI_TIMEOUT_MS,
  resolvePiTimeoutMs,
} from '@/executor/handlers/pi/cloud-shared'

describe('resolvePiTimeoutMs', () => {
  it('reserves every command budget that brackets the agent turn', () => {
    // Capping at the bare sandbox lifetime would mean the sandbox always died
    // first, taking the agent's finished work with it unpushed. Create PR runs
    // three bracketing commands, and the commit and the push each get the full
    // finalize budget — reserving only one of them leaves the push unbudgeted,
    // which is exactly when losing the sandbox costs the most.
    const timeout = resolvePiTimeoutMs(PI_SANDBOX_MAX_LIFETIME_MS)
    expect(timeout).toBeLessThanOrEqual(
      PI_SANDBOX_MAX_LIFETIME_MS - CLONE_TIMEOUT_MS - 2 * FINALIZE_TIMEOUT_MS
    )
    expect(timeout).toBeGreaterThan(0)
  })

  it('reserves against the lifetime it is given, not the provider ceiling', () => {
    // The whole point of taking an argument: a run whose execution deadline is
    // shorter than the ceiling gets a sandbox that short, so reserving against
    // the ceiling would hand the agent a turn longer than its own sandbox lives
    // — the exact bug the reserve exists to prevent.
    const shortLifetime = PI_SANDBOX_MAX_LIFETIME_MS / 2
    expect(resolvePiTimeoutMs(shortLifetime)).toBeLessThan(
      resolvePiTimeoutMs(PI_SANDBOX_MAX_LIFETIME_MS)
    )
    expect(resolvePiTimeoutMs(shortLifetime)).toBeLessThanOrEqual(shortLifetime)
  })

  it('falls back to the single-turn floor when the reserves exhaust the lifetime', () => {
    // A deadline shorter than the bracketing commands' worst case is legitimate
    // (a free-plan sync run). Those ceilings are pessimistic, so leave a short
    // turn rather than a negative one.
    expect(resolvePiTimeoutMs(CLONE_TIMEOUT_MS)).toBe(MIN_PI_TIMEOUT_MS)
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

describe('buildPiScript', () => {
  it('disables every repository-supplied Pi resource for Babysit with or without search', () => {
    for (const script of [
      buildPiScript(undefined, { disableRepositoryResources: true }),
      buildPiScript('/workspace/search.ts', { disableRepositoryResources: true }),
    ]) {
      expect(script).toContain('--no-extensions')
      expect(script).toContain('--no-prompt-templates')
      expect(script).toContain('--no-skills')
      expect(script).toContain('--no-approve')
    }
    expect(buildPiScript('/workspace/search.ts', { disableRepositoryResources: true })).toContain(
      '-e /workspace/search.ts'
    )
  })

  it('preserves the Create PR command when no hardening option is passed', () => {
    expect(buildPiScript()).not.toContain('--no-extensions')
    expect(buildPiScript()).not.toContain('--no-prompt-templates')
  })
})
