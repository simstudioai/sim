/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { type CollabReadinessInputs, nextCollabReadiness } from './readiness'

/** An observation, with the healthy defaults filled in so each case states only what it exercises. */
const at = (input: Partial<CollabReadinessInputs>): CollabReadinessInputs => ({
  synced: false,
  seeded: false,
  offlineSeed: false,
  fatal: false,
  ...input,
})

/** Drive a sequence of observations through the latch, returning the readiness at each step. */
function run(steps: Partial<CollabReadinessInputs>[]): boolean[] {
  let syncedOnce = false
  return steps.map((step) => {
    const next = nextCollabReadiness(syncedOnce, at(step))
    syncedOnce = next.syncedOnce
    return next.ready
  })
}

describe('nextCollabReadiness', () => {
  it('is not ready before syncing or seeding', () => {
    const { syncedOnce, ready } = nextCollabReadiness(
      false,
      at({
        synced: false,
        seeded: false,
        offlineSeed: false,
      })
    )
    expect(syncedOnce).toBe(false)
    expect(ready).toBe(false)
  })

  it('is not ready when synced but not yet seeded', () => {
    const { syncedOnce, ready } = nextCollabReadiness(
      false,
      at({
        synced: true,
        seeded: false,
        offlineSeed: false,
      })
    )
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
    const { syncedOnce, ready } = nextCollabReadiness(
      false,
      at({
        synced: false,
        seeded: true,
        offlineSeed: false,
      })
    )
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
  /**
   * The reported bug. A brand-new file syncs EMPTY (latching `syncedOnce`), its server seed never
   * lands, and the readiness deadline fires: the provider goes fatal and drops `synced` precisely so
   * this gate closes. The offline fallback then seeds locally — and the sticky latch used to re-open
   * the gate on that, handing back an editable editor bound to a document the provider had abandoned.
   * Every keystroke was dropped (the provider ignores frames and never rejoins) and client autosave
   * stayed off (collaboration is nominally on), so the edits vanished on reload with no error shown.
   */
  it('stays read-only after the readiness deadline goes fatal, even though a sync was latched', () => {
    const readiness = run([
      { synced: false },
      { synced: true }, // initial EMPTY sync — latches syncedOnce
      { synced: false, fatal: true }, // deadline: provider drops synced and gives up
      { seeded: true, offlineSeed: true, fatal: true }, // fallback seeds locally
    ])
    expect(readiness).toEqual([false, false, false, false])
  })

  /**
   * The same revocation on an ALREADY-ready doc: access is withdrawn mid-session, the provider goes
   * fatal, and readiness must be taken back rather than left latched open.
   */
  it('revokes readiness when a live document turns fatal', () => {
    const readiness = run([
      { synced: true, seeded: true }, // ready
      { synced: false, seeded: true, fatal: true }, // access revoked mid-session
    ])
    expect(readiness).toEqual([true, false])
  })
})
