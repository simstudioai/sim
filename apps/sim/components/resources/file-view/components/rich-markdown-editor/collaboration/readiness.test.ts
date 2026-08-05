/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { type CollabReadinessInputs, nextCollabReadiness } from './readiness'

/** Drive a sequence of observations through the latch, returning the readiness at each step. */
function run(steps: CollabReadinessInputs[]): boolean[] {
  let syncedOnce = false
  return steps.map((input) => {
    const next = nextCollabReadiness(syncedOnce, input)
    syncedOnce = next.syncedOnce
    return next.ready
  })
}

describe('nextCollabReadiness', () => {
  it('is not ready before syncing or seeding', () => {
    const { syncedOnce, ready } = nextCollabReadiness(false, {
      synced: false,
      seeded: false,
      offlineSeed: false,
    })
    expect(syncedOnce).toBe(false)
    expect(ready).toBe(false)
  })

  it('is not ready when synced but not yet seeded', () => {
    const { syncedOnce, ready } = nextCollabReadiness(false, {
      synced: true,
      seeded: false,
      offlineSeed: false,
    })
    expect(syncedOnce).toBe(true) // latched
    expect(ready).toBe(false) // waits for the seed
  })

  it('opens on the new-file flap sequence: synced true, then seed lands while synced flapped false', () => {
    // The exact bug: `synced` and `seeded` are never true in the same observation. The latch must still
    // open once BOTH have been seen across observations.
    const readiness = run([
      { synced: false, seeded: false, offlineSeed: false }, // joining
      { synced: true, seeded: false, offlineSeed: false }, // initial (empty) sync
      { synced: false, seeded: false, offlineSeed: false }, // synced flaps false on re-sync
      { synced: false, seeded: true, offlineSeed: false }, // server seed lands (synced still false)
    ])
    expect(readiness).toEqual([false, false, false, true])
  })

  it('opens even if the seed lands before we ever observed synced (server seed proves a sync)', () => {
    // If the flap beat our first observation, the seed flag alone (not the offline fallback) proves a
    // completed sync happened.
    const { syncedOnce, ready } = nextCollabReadiness(false, {
      synced: false,
      seeded: true,
      offlineSeed: false,
    })
    expect(syncedOnce).toBe(true)
    expect(ready).toBe(true)
  })

  it('stays read-only for an offline (local) seed that never reached the server', () => {
    const readiness = run([
      { synced: false, seeded: false, offlineSeed: false },
      { synced: false, seeded: true, offlineSeed: true }, // offline fallback seeded locally
    ])
    expect(readiness).toEqual([false, false])
  })

  it('never reverts once ready, even if synced later flaps false', () => {
    const readiness = run([
      { synced: true, seeded: true, offlineSeed: false }, // ready
      { synced: false, seeded: true, offlineSeed: false }, // synced flaps — must stay ready
    ])
    expect(readiness).toEqual([true, true])
  })
})
