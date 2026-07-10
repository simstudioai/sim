import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isRecordLike as isRecord } from '@sim/utils/object'
import { getRedisClient } from '@/lib/core/config/redis'
import { getExecutionReservationTtlMs } from '@/lib/core/execution-limits'
import type { ExecutionLastCompletedBlock, ExecutionLastStartedBlock } from '@/lib/logs/types'

const logger = createLogger('ExecutionProgressMarkers')

/**
 * Live per-block progress markers (`lastStartedBlock` / `lastCompletedBlock`)
 * used to be written to `workflow_execution_logs.execution_data` via a
 * `jsonb_set` UPDATE on every block start and complete — ~2N row UPDATEs per
 * run and the single heaviest write query in the database. They carry no
 * value beyond a breadcrumb folded into the final record (no client polls
 * them; live progress comes from the executor over WebSocket), so they live
 * in Redis during the run and are folded into the single terminal UPDATE at
 * completion. See the logs-contention plan for the full rationale.
 */

/** Redis key namespace — matches the `execution:*` family (stream, cancel, budget). */
const PROGRESS_KEY_PREFIX = 'execution:progress:'

const STARTED_FIELD = 'started'
const COMPLETED_FIELD = 'completed'

/**
 * Single source of the client used for progress markers. Indirection kept so a
 * future split to a dedicated `LOGS_REDIS_URL` is a one-line change here.
 */
function getMarkerClient() {
  return getRedisClient()
}

function markerKey(executionId: string): string {
  return `${PROGRESS_KEY_PREFIX}${executionId}`
}

/**
 * Atomic monotonic write: set the field only when the incoming marker's embedded
 * timestamp is >= the stored one, then refresh the TTL — all in one script so
 * concurrent block callbacks can't race a read-modify-write. Preserves the exact
 * `<=` ordering the legacy SQL used (`COALESCE(stored, '') <= incoming`). ISO
 * UTC timestamps compare correctly lexicographically.
 */
const SET_MARKER_SCRIPT = `
local existing = redis.call('HGET', KEYS[1], ARGV[1])
if existing then
  local ok, decoded = pcall(cjson.decode, existing)
  if ok and type(decoded) == 'table' and decoded[ARGV[2]] and tostring(decoded[ARGV[2]]) > ARGV[3] then
    redis.call('PEXPIRE', KEYS[1], ARGV[5])
    return 0
  end
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return 1
`

/**
 * Write a marker field under the monotonic guard, refreshing the key TTL. The
 * TTL is a backstop for executions that die without a terminal/pause boundary
 * (deterministic cleanup is {@link clearProgressMarkers}); it mirrors the
 * admission-reservation TTL so a crashed run's marker key and slot expire
 * together. Returns `true` only when the marker was durably written to Redis,
 * so callers can fall back to the SQL path on a missing client or a failure.
 */
async function setMarker(
  executionId: string,
  field: string,
  timestampField: 'startedAt' | 'endedAt',
  timestamp: string,
  marker: ExecutionLastStartedBlock | ExecutionLastCompletedBlock
): Promise<boolean> {
  const redis = getMarkerClient()
  if (!redis) return false

  try {
    await redis.eval(
      SET_MARKER_SCRIPT,
      1,
      markerKey(executionId),
      field,
      timestampField,
      timestamp,
      JSON.stringify(marker),
      getExecutionReservationTtlMs().toString()
    )
    return true
  } catch (error) {
    logger.error(`Failed to persist progress marker for execution ${executionId}`, {
      field,
      error: toError(error).message,
    })
    return false
  }
}

/**
 * Persist the last-started-block marker. Returns `false` (caller should fall
 * back to the durable SQL path) when Redis is unavailable or the write fails.
 */
export async function setLastStartedBlock(
  executionId: string,
  marker: ExecutionLastStartedBlock
): Promise<boolean> {
  return setMarker(executionId, STARTED_FIELD, 'startedAt', marker.startedAt, marker)
}

/**
 * Persist the last-completed-block marker. Returns `false` (caller should fall
 * back to the durable SQL path) when Redis is unavailable or the write fails.
 */
export async function setLastCompletedBlock(
  executionId: string,
  marker: ExecutionLastCompletedBlock
): Promise<boolean> {
  return setMarker(executionId, COMPLETED_FIELD, 'endedAt', marker.endedAt, marker)
}

export interface ExecutionProgressMarkers {
  lastStartedBlock?: ExecutionLastStartedBlock
  lastCompletedBlock?: ExecutionLastCompletedBlock
}

/**
 * Pick the later of two last-started markers by `startedAt`. Markers can split
 * across stores — a failed Redis write falls back to the row, so an earlier
 * successful Redis write may coexist with a newer row marker (or vice versa).
 * Choosing by timestamp keeps the freshest breadcrumb regardless of which store
 * holds it. ISO UTC timestamps compare correctly lexicographically.
 */
export function pickLatestStartedMarker(
  a: ExecutionLastStartedBlock | undefined,
  b: ExecutionLastStartedBlock | undefined
): ExecutionLastStartedBlock | undefined {
  if (!a) return b
  if (!b) return a
  return a.startedAt >= b.startedAt ? a : b
}

/** Pick the later of two last-completed markers by `endedAt`. See {@link pickLatestStartedMarker}. */
export function pickLatestCompletedMarker(
  a: ExecutionLastCompletedBlock | undefined,
  b: ExecutionLastCompletedBlock | undefined
): ExecutionLastCompletedBlock | undefined {
  if (!a) return b
  if (!b) return a
  return a.endedAt >= b.endedAt ? a : b
}

function safeJsonParse(raw: string | undefined): unknown {
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/**
 * Parse a stored last-started marker, rebuilding it from validated fields so a
 * stale or wrong-shaped Redis value can never reach API consumers.
 */
function parseStartedMarker(raw: string | undefined): ExecutionLastStartedBlock | undefined {
  const v = safeJsonParse(raw)
  if (!isRecord(v)) return undefined
  const { blockId, blockName, blockType, startedAt } = v
  if (
    typeof blockId === 'string' &&
    typeof blockName === 'string' &&
    typeof blockType === 'string' &&
    typeof startedAt === 'string'
  ) {
    return { blockId, blockName, blockType, startedAt }
  }
  return undefined
}

/**
 * Parse a stored last-completed marker, rebuilding it from validated fields so a
 * stale or wrong-shaped Redis value can never reach API consumers.
 */
function parseCompletedMarker(raw: string | undefined): ExecutionLastCompletedBlock | undefined {
  const v = safeJsonParse(raw)
  if (!isRecord(v)) return undefined
  const { blockId, blockName, blockType, endedAt, success } = v
  if (
    typeof blockId === 'string' &&
    typeof blockName === 'string' &&
    typeof blockType === 'string' &&
    typeof endedAt === 'string' &&
    typeof success === 'boolean'
  ) {
    return { blockId, blockName, blockType, endedAt, success }
  }
  return undefined
}

/**
 * Read both markers for an execution. Returns an empty object when Redis is
 * unavailable (markers were never stored here) or the key holds nothing, and
 * `null` when the Redis read itself failed — callers must treat `null` as
 * "unknown" and skip {@link clearProgressMarkers}, so a transient read error
 * never wipes the only copy of markers that are still in Redis.
 */
export async function getProgressMarkers(
  executionId: string
): Promise<ExecutionProgressMarkers | null> {
  const redis = getMarkerClient()
  if (!redis) return {}

  try {
    const fields = await redis.hgetall(markerKey(executionId))
    if (!fields || Object.keys(fields).length === 0) return {}

    const result: ExecutionProgressMarkers = {}
    const started = parseStartedMarker(fields[STARTED_FIELD])
    if (started) result.lastStartedBlock = started
    const completed = parseCompletedMarker(fields[COMPLETED_FIELD])
    if (completed) result.lastCompletedBlock = completed
    return result
  } catch (error) {
    logger.error(`Failed to read progress markers for execution ${executionId}`, {
      error: toError(error).message,
    })
    return null
  }
}

/**
 * Delete the markers for an execution. Called at every terminal/pause boundary
 * after the durable record has been written, so paused executions (which can
 * live indefinitely) hold no Redis keys. Fire-and-forget; no-op without Redis.
 */
export async function clearProgressMarkers(executionId: string): Promise<void> {
  const redis = getMarkerClient()
  if (!redis) return

  try {
    await redis.del(markerKey(executionId))
  } catch (error) {
    logger.error(`Failed to clear progress markers for execution ${executionId}`, {
      error: toError(error).message,
    })
  }
}
