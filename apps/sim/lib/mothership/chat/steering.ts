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
   * The exact input Sim sent the worker for it, an outbox entry kept only until its
   * disposition is final, so a read before then re-sends identical bytes. It can
   * hold rendered mentions and base64 images, so no reader outside the steering
   * path sees it (`withoutSteeringInput`).
   */
  input?: unknown
  /** The worker's final answer for it, which later reads return without asking again. */
  disposition?: SteeringFinalDisposition
}

/** A disposition no later read can change: the input is no longer needed once it is known. */
export type SteeringFinalDisposition =
  | { status: 'applied'; eventSeq?: number; textOffset?: number }
  | { status: 'not_applied' }

/** Where a turn applied a steering message: its assistant's `steering` block. */
export interface SteeringBlockInfo {
  steeringId: string
}

/**
 * A transcript without the steering messages it shows no turn applying. Only an applied
 * one is in the conversation: the worker has no input event for the rest, and in a copy
 * of the transcript nothing could ever deliver them. A row re-marked as a turn's own
 * message (`streamId` is its own id) is that turn, and stays.
 */
export function withoutUnappliedSteering<
  M extends {
    id: string
    steering?: { streamId: string }
    contentBlocks?: ReadonlyArray<{ steering?: { steeringId?: string } }>
  },
>(messages: readonly M[]): M[] {
  const applied = new Set(
    messages.flatMap((message) =>
      (message.contentBlocks ?? []).flatMap((block) =>
        block.steering?.steeringId ? [block.steering.steeringId] : []
      )
    )
  )
  return messages.filter(
    (message) =>
      !message.steering || message.steering.streamId === message.id || applied.has(message.id)
  )
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
