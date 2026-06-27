import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
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
  if ok and decoded[ARGV[2]] and tostring(decoded[ARGV[2]]) > ARGV[3] then
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
 * together.
 */
async function setMarker(
  executionId: string,
  field: string,
  timestampField: 'startedAt' | 'endedAt',
  timestamp: string,
  marker: ExecutionLastStartedBlock | ExecutionLastCompletedBlock
): Promise<void> {
  const redis = getMarkerClient()
  if (!redis) return

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
  } catch (error) {
    logger.error(`Failed to persist progress marker for execution ${executionId}`, {
      field,
      error: toError(error).message,
    })
  }
}

/** Persist the last-started-block marker. No-op when Redis is unavailable. */
export async function setLastStartedBlock(
  executionId: string,
  marker: ExecutionLastStartedBlock
): Promise<void> {
  await setMarker(executionId, STARTED_FIELD, 'startedAt', marker.startedAt, marker)
}

/** Persist the last-completed-block marker. No-op when Redis is unavailable. */
export async function setLastCompletedBlock(
  executionId: string,
  marker: ExecutionLastCompletedBlock
): Promise<void> {
  await setMarker(executionId, COMPLETED_FIELD, 'endedAt', marker.endedAt, marker)
}

export interface ExecutionProgressMarkers {
  lastStartedBlock?: ExecutionLastStartedBlock
  lastCompletedBlock?: ExecutionLastCompletedBlock
}

function parseMarker<T>(raw: string | undefined): T | undefined {
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

/**
 * Read both markers for an execution. Returns an empty object when Redis is
 * unavailable, the key has expired, or nothing has been written yet.
 */
export async function getProgressMarkers(executionId: string): Promise<ExecutionProgressMarkers> {
  const redis = getMarkerClient()
  if (!redis) return {}

  try {
    const fields = await redis.hgetall(markerKey(executionId))
    if (!fields || Object.keys(fields).length === 0) return {}

    const result: ExecutionProgressMarkers = {}
    const started = parseMarker<ExecutionLastStartedBlock>(fields[STARTED_FIELD])
    if (started) result.lastStartedBlock = started
    const completed = parseMarker<ExecutionLastCompletedBlock>(fields[COMPLETED_FIELD])
    if (completed) result.lastCompletedBlock = completed
    return result
  } catch (error) {
    logger.error(`Failed to read progress markers for execution ${executionId}`, {
      error: toError(error).message,
    })
    return {}
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
