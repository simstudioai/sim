import type { Context } from '@opentelemetry/api'
import { sleep } from '@sim/utils/helpers'
import { toRecord } from '@sim/utils/object'
import type { z } from 'zod'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ChatContextItem,
  type SteerV2Request,
  SteerV2Response,
} from '@/lib/mothership/generated/protocol'
import { TraceAttr } from '@/lib/mothership/generated/trace-attributes-v1'
import { fetchGo } from '@/lib/mothership/request/go/fetch'
import { mothershipRequestHeaders } from '@/lib/mothership/request/headers'
import { getMothershipBaseURL } from '@/lib/mothership/server/agent-url'

const DEFAULT_STEER_TIMEOUT_MS = 3000
/**
 * How long a steer naming a run the worker does not know yet is retried. Sim
 * admits a run before the worker inserts it, so a steer sent right after
 * admission can arrive first; past this the run is taken as gone.
 */
const TARGET_MISSING_RETRY_DELAYS_MS = [100, 250, 500, 1000]
/**
 * How long a run at its pending-input budget (429 `steering_capacity`) is given to
 * apply what it holds before the message is refused and goes out as a turn.
 */
const CAPACITY_RETRY_DELAYS_MS = [250, 500, 1000]

/**
 * What the worker did with a steering message:
 * - `queued`: accepted for the run's next model step, not yet applied;
 * - `applied`: the run applied it, at `textOffset` of its answer (`eventSeq` in its log);
 * - `not_applied`: the run closed before applying it, and never will;
 * - `refused`: no run holds it: the worker does not know the run, stayed at its
 *   pending-input capacity, reached the run's image limit, cannot take its
 *   context (`steering_scope`), or has no durable steering (`goStatus`).
 */
type StreamSteeringResult =
  | { status: 'queued' }
  | { status: 'applied'; eventSeq?: number; textOffset?: number }
  | { status: 'not_applied' }
  | { status: 'refused'; goStatus: number }

interface SteeringRequest {
  streamId: string
  userId: string
  chatId: string
  steeringId: string
  content: string
  /** The message's attachments and mentions, rendered as a turn renders its own. */
  context?: ChatContextItem[]
  assistantImages?: z.input<typeof SteerV2Request>['assistantImages']
  timeoutMs?: number
  otelContext?: Context
}

/**
 * Sends a mid-turn steering message to the worker's v2 route and returns its
 * durable disposition. A retry of the same id and content reads that disposition
 * again, which is what lets a sender that lost track of a message learn whether
 * a run applied it.
 *
 * Steering goes through v2 only. A worker without it (the route answers a bare
 * 404/405) refuses: v1 keeps no record, so a sender that missed its
 * `steering_applied` frame could not tell an applied message from a lost one and
 * would send it twice. Refused, the message goes out as a turn once the running
 * one ends, as a follow-up always did.
 *
 * A transport failure throws: the worker may hold the message, and only a retry
 * under the same id can say. `steering_target_missing` (a run it does not know,
 * including one Sim admitted that the worker has not inserted yet) is retried
 * briefly, then refused: a run the worker never knew cannot apply the message.
 */
export async function requestStreamSteering(
  params: SteeringRequest
): Promise<StreamSteeringResult> {
  const baseUrl = await getMothershipBaseURL({ userId: params.userId })
  let response = await postSteering(`${baseUrl}/api/streams/steer/v2`, params)
  let targetRetries = 0
  let capacityRetries = 0
  while (true) {
    const code = await failureCode(response)
    const delayMs =
      code === 'steering_target_missing'
        ? TARGET_MISSING_RETRY_DELAYS_MS[targetRetries++]
        : response.status === 429
          ? CAPACITY_RETRY_DELAYS_MS[capacityRetries++]
          : undefined
    if (delayMs === undefined) break
    await sleep(delayMs)
    response = await postSteering(`${baseUrl}/api/streams/steer/v2`, params)
  }
  if (response.ok) {
    // boundary-raw-json: the worker's disposition is validated by its generated schema.
    const body: unknown = await response.json()
    const disposition = SteerV2Response.parse(body)
    if (disposition.steeringId !== params.steeringId) {
      throw new Error('Worker returned the disposition of another steering message')
    }
    if (disposition.status !== 'applied') return { status: disposition.status }
    return {
      status: 'applied',
      eventSeq: disposition.eventSeq,
      textOffset: disposition.textOffset,
    }
  }
  const code = await failureCode(response)
  if (response.status === 409) {
    throw new OrchestrationError('conflict', 'This steering id was already used for other content.')
  }
  /* Refusals the message survives as a turn of its own: an unknown run, a
     pending-input budget still full after the retries, the run's lifetime image
     limit (final, never retried as a steer), a context only a turn can carry, and
     a worker without v2 (a bare 404/405, no error code). */
  if (
    code === 'steering_target_missing' ||
    response.status === 429 ||
    code === 'steering_image_limit' ||
    code === 'steering_scope' ||
    ((response.status === 404 || response.status === 405) && !code)
  ) {
    return { status: 'refused', goStatus: response.status }
  }
  if (response.status === 400) {
    throw new OrchestrationError('validation', 'This message cannot steer the running turn.')
  }
  throw new Error(`Steering disposition unavailable (${response.status})`)
}

const failureCodes = new WeakMap<Response, string | undefined>()

/** A failed answer's worker error code; reads the body once and remembers it. */
async function failureCode(response: Response): Promise<string | undefined> {
  if (response.ok) return undefined
  if (failureCodes.has(response)) return failureCodes.get(response)
  // boundary-raw-json: only the worker's error code is read, to tell its refusals apart.
  const body: unknown = await response.json().catch(() => null)
  const code = toRecord(body).code
  const known = typeof code === 'string' ? code : undefined
  failureCodes.set(response, known)
  return known
}

function postSteering(url: string, params: SteeringRequest): Promise<Response> {
  const { streamId, chatId, steeringId, content, context, assistantImages, otelContext } = params
  const body: z.input<typeof SteerV2Request> = {
    messageId: streamId,
    steeringId,
    content,
    ...(context?.length ? { context } : {}),
    ...(assistantImages?.length ? { assistantImages } : {}),
  }
  return fetchGo(url, {
    method: 'POST',
    headers: mothershipRequestHeaders(),
    signal: AbortSignal.timeout(params.timeoutMs ?? DEFAULT_STEER_TIMEOUT_MS),
    body: JSON.stringify(body),
    otelContext,
    spanName: 'sim → go /api/streams/steer/v2',
    operation: 'steer',
    attributes: {
      [TraceAttr.StreamId]: streamId,
      [TraceAttr.ChatId]: chatId,
    },
  })
}
