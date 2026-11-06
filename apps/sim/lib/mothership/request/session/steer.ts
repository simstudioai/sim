import type { Context } from '@opentelemetry/api'
import { sleep } from '@sim/utils/helpers'
import { toRecord } from '@sim/utils/object'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { SteerV2Response } from '@/lib/mothership/generated/protocol'
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
 * What the worker did with a steering message:
 * - `queued`: accepted for the run's next model step, not yet applied;
 * - `applied`: the run applied it (v2 only; v1 says so only on the stream);
 * - `not_applied`: the run closed before applying it (v2 only);
 * - `refused`: no run holds it: the worker does not know the run, is at its
 *   pending-input capacity, or (v1) did not accept it (`goStatus`, 0 when
 *   unreachable), which v1 cannot tell apart from a run that already closed.
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
  timeoutMs?: number
  otelContext?: Context
}

/**
 * Sends a mid-turn steering message to the worker, asking v2 for its durable
 * disposition first and falling back to v1 while a worker without v2 answers
 * that route with a bare 404/405.
 *
 * A v2 transport failure throws: the worker may hold the message, and only a
 * retry under the same id can say whether it does. v2's `steering_target_missing`
 * (a run it does not know, including one Sim admitted that the worker has not
 * inserted yet) is retried briefly, then refused: a run the worker never knew
 * cannot apply the message, so sending it as a turn of its own is safe. v1
 * acceptance means "queued"; application is acknowledged by a
 * `run`/`steering_applied` stream frame carrying the steering id, and a caller
 * that never sees it re-sends the content as an ordinary message.
 */
export async function requestStreamSteering(
  params: SteeringRequest
): Promise<StreamSteeringResult> {
  const baseUrl = await getMothershipBaseURL({ userId: params.userId })
  let v2 = await postSteering(`${baseUrl}/api/streams/steer/v2`, params)
  for (const delayMs of TARGET_MISSING_RETRY_DELAYS_MS) {
    if (!(await isTargetMissing(v2))) break
    await sleep(delayMs)
    v2 = await postSteering(`${baseUrl}/api/streams/steer/v2`, params)
  }
  if (v2.ok) {
    // boundary-raw-json: the worker's disposition is validated by its generated schema.
    const body: unknown = await v2.json()
    const disposition = SteerV2Response.parse(body)
    if (disposition.steeringId !== params.steeringId) {
      throw new Error('Worker returned the disposition of another steering message')
    }
    if (disposition.status !== 'applied') return { status: disposition.status }
    return {
      status: 'applied',
      ...(disposition.eventSeq !== undefined ? { eventSeq: disposition.eventSeq } : {}),
      ...(disposition.textOffset !== undefined ? { textOffset: disposition.textOffset } : {}),
    }
  }
  if (await isTargetMissing(v2)) return { status: 'refused', goStatus: 404 }
  await v2.body?.cancel().catch(() => {})
  if (v2.status === 409) {
    throw new OrchestrationError('conflict', 'This steering id was already used for other content.')
  }
  if (v2.status === 429) return { status: 'refused', goStatus: 429 }
  if (v2.status === 400) {
    throw new OrchestrationError('validation', 'This message cannot steer the running turn.')
  }
  if (v2.status !== 404 && v2.status !== 405) {
    throw new Error(`Steering disposition unavailable (${v2.status})`)
  }
  try {
    const v1 = await postSteering(`${baseUrl}/api/streams/steer`, params)
    await v1.body?.cancel()
    return v1.ok ? { status: 'queued' } : { status: 'refused', goStatus: v1.status }
  } catch {
    return { status: 'refused', goStatus: 0 }
  }
}

const targetMissing = new WeakMap<Response, boolean>()

/** Whether a v2 answer is `steering_target_missing`; reads the body once and remembers it. */
async function isTargetMissing(response: Response): Promise<boolean> {
  if (response.status !== 404) return false
  const known = targetMissing.get(response)
  if (known !== undefined) return known
  // boundary-raw-json: only the worker's error code is read, to tell a missing run from a missing route.
  const body: unknown = await response.json().catch(() => null)
  const missing = toRecord(body).code === 'steering_target_missing'
  targetMissing.set(response, missing)
  return missing
}

function postSteering(url: string, params: SteeringRequest): Promise<Response> {
  const { streamId, chatId, steeringId, content, otelContext } = params
  return fetchGo(url, {
    method: 'POST',
    headers: mothershipRequestHeaders(),
    signal: AbortSignal.timeout(params.timeoutMs ?? DEFAULT_STEER_TIMEOUT_MS),
    body: JSON.stringify({ messageId: streamId, steeringId, content }),
    otelContext,
    spanName: `sim → go ${new URL(url).pathname}`,
    operation: 'steer',
    attributes: {
      [TraceAttr.StreamId]: streamId,
      [TraceAttr.ChatId]: chatId,
    },
  })
}
