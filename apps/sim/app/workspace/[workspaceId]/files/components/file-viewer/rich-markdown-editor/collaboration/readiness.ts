/**
 * Collaborative-readiness latch for the file editor.
 *
 * A file becomes "ready" (editable + agent streaming enabled) once its shared doc has both SYNCED and
 * SEEDED. The subtlety this latch solves: a brand-new file's provider reports `synced: true` on the
 * initial (empty) sync, then the SERVER pushes the seed and receiving that update flips `synced` back to
 * `false` — so `synced` and `seeded` are never `true` in the same observation. An un-latched
 * `synced && seeded` gate would therefore never open, and agent streaming would be dropped for the whole
 * run (the file only fills in on reload).
 *
 * The latch: `syncedOnce` is sticky — set the first time a completed sync is observed, and it never
 * reverts. A completed sync is proven by EITHER a live `synced`, OR the seed flag being present without
 * the offline fallback having set it (`offlineSeed`) — because a SERVER seed can only arrive after a
 * sync, whereas the offline fallback seeds locally without ever reaching the server and must stay
 * read-only. Once `syncedOnce` is set, a later `synced` flap can no longer re-gate the doc.
 */

export interface CollabReadinessInputs {
  /** The provider's current `synced` flag (may flap false after the seed update). */
  synced: boolean
  /** Whether the shared doc carries the seed flag. */
  seeded: boolean
  /** Whether the seed flag was set by the offline fallback (no server sync) rather than the server. */
  offlineSeed: boolean
}

/**
 * Pure transition for the readiness latch. `syncedOnce` is the sticky prior state — pass the returned
 * `syncedOnce` back in on the next call. `ready` is whether the doc is synced-and-seeded.
 */
export function nextCollabReadiness(
  syncedOnce: boolean,
  input: CollabReadinessInputs
): { syncedOnce: boolean; ready: boolean } {
  const next = syncedOnce || input.synced || (input.seeded && !input.offlineSeed)
  return { syncedOnce: next, ready: next && input.seeded }
}
