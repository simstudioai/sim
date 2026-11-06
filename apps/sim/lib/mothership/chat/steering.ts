import { toRecord } from '@sim/utils/object'
import { MothershipStreamV1RunKind } from '@/lib/mothership/generated/mothership-stream-v1'

/**
 * Marks a user message that was sent into a running turn as steering rather than
 * as a turn of its own: `streamId` is the turn it was sent into. A transcript
 * shows it where that turn applied it (its turn's `steering` block), or not at
 * all once the turn ended without applying it, since its sender then delivers it
 * as an ordinary turn under another id.
 */
export interface SteeringMessageMarker {
  streamId: string
  /**
   * The exact input Sim sent the worker for it, stored server-side so a later
   * read of its disposition re-sends identical bytes. Never read back into a
   * transcript (`normalizeMessage` keeps only `streamId`).
   */
  input?: unknown
}

/** Where a turn applied a steering message: its assistant's `steering` block. */
export interface SteeringBlockInfo {
  steeringId: string
}

/**
 * The steering id a `run` payload acknowledges as applied, if it is a
 * `steering_applied` frame. Read untyped, since the reducers it serves (live view,
 * server persistence, stopped-turn replay) see run payloads from workers both with
 * and without the typed frame, in one place.
 */
export function readAppliedSteeringId(payload: unknown): string | undefined {
  const record = toRecord(payload)
  if (record.kind !== MothershipStreamV1RunKind.steering_applied) return undefined
  return typeof record.steeringId === 'string' && record.steeringId ? record.steeringId : undefined
}
