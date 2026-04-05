import { createLogger } from '@sim/logger'
import type Redis from 'ioredis'
import { generateId } from '@/lib/core/utils/uuid'
import type { WorkspaceDispatchStorageAdapter } from '@/lib/core/workspace-dispatch/adapter'
import {
  WORKSPACE_DISPATCH_CLAIM_RESULTS,
  type WorkspaceDispatchClaimResult,
  type WorkspaceDispatchEnqueueInput,
  type WorkspaceDispatchJobRecord,
  type WorkspaceDispatchLane,
} from '@/lib/core/workspace-dispatch/types'

const logger = createLogger('WorkspaceDispatchRedisStore')

const DISPATCH_PREFIX = 'workspace-dispatch:v1'
const JOB_TTL_SECONDS = 48 * 60 * 60
const SEQUENCE_KEY = `${DISPATCH_PREFIX}:sequence`
const ACTIVE_WORKSPACES_KEY = `${DISPATCH_PREFIX}:workspaces`
const GLOBAL_DEPTH_KEY = `${DISPATCH_PREFIX}:global-depth`
const CLAIM_JOB_SCRIPT = `
local workspaceId = ARGV[1]
local now = tonumber(ARGV[2])
local concurrencyLimit = tonumber(ARGV[3])
local leaseId = ARGV[4]
local leaseExpiresAt = tonumber(ARGV[5])
local lanes = cjson.decode(ARGV[6])
local sequenceKey = ARGV[7]
local activeWorkspacesKey = ARGV[8]
local jobPrefix = ARGV[9]
local workspacePrefix = ARGV[10]
local jobTtlSeconds = tonumber(ARGV[11])

local function laneKey(lane)
  return workspacePrefix .. workspaceId .. ':lane:' .. lane
end

local function leaseKey()
  return workspacePrefix .. workspaceId .. ':leases'
end

local function workspaceHasPending()
  local minReadyAt = nil
  local hasPending = false

  for _, lane in ipairs(lanes) do
    local ids = redis.call('ZRANGE', laneKey(lane), 0, 0)
    if #ids > 0 then
      local raw = redis.call('GET', jobPrefix .. ids[1])
      if raw then
        hasPending = true
        local record = cjson.decode(raw)
        local readyAt = (record.createdAt or 0) + (record.delayMs or 0)
        if (minReadyAt == nil) or (readyAt < minReadyAt) then
          minReadyAt = readyAt
        end
      else
        redis.call('ZREM', laneKey(lane), ids[1])
      end
    end
  end

  return hasPending, minReadyAt
end

redis.call('ZREMRANGEBYSCORE', leaseKey(), 0, now)
local activeLeaseCount = redis.call('ZCARD', leaseKey())
if activeLeaseCount >= concurrencyLimit then
  return cjson.encode({ type = 'limit_reached' })
end

local selectedId = nil
local selectedLane = nil
local selectedRecord = nil
local delayedNextReadyAt = nil

local maxScanPerLane = 20

for _, lane in ipairs(lanes) do
  local ids = redis.call('ZRANGE', laneKey(lane), 0, maxScanPerLane - 1)
  for _, candidateId in ipairs(ids) do
    local raw = redis.call('GET', jobPrefix .. candidateId)
    if raw then
      local record = cjson.decode(raw)
      local readyAt = (record.createdAt or 0) + (record.delayMs or 0)
      if readyAt <= now then
        selectedId = candidateId
        selectedLane = lane
        selectedRecord = record
        break
      end

      if (delayedNextReadyAt == nil) or (readyAt < delayedNextReadyAt) then
        delayedNextReadyAt = readyAt
      end
    else
      redis.call('ZREM', laneKey(lane), candidateId)
    end
  end

  if selectedRecord then
    break
  end
end

if selectedRecord == nil then
  local hasPending, minReadyAt = workspaceHasPending()
  if not hasPending then
    return cjson.encode({ type = 'empty' })
  end

  local sequence = redis.call('INCR', sequenceKey)
  local score = sequence
  if minReadyAt ~= nil and minReadyAt > now then
    score = minReadyAt * 1000000 + sequence
  end
  redis.call('ZADD', activeWorkspacesKey, score, workspaceId)

  return cjson.encode({
    type = 'delayed',
    nextReadyAt = delayedNextReadyAt or minReadyAt or now
  })
end

redis.call('ZADD', leaseKey(), leaseExpiresAt, leaseId)
selectedRecord.status = 'admitting'
selectedRecord.lease = {
  workspaceId = workspaceId,
  leaseId = leaseId
}
if selectedRecord.metadata == nil then
  selectedRecord.metadata = {}
end
selectedRecord.metadata.dispatchLeaseExpiresAt = leaseExpiresAt

redis.call('SET', jobPrefix .. selectedId, cjson.encode(selectedRecord), 'EX', jobTtlSeconds)
redis.call('ZREM', laneKey(selectedLane), selectedId)

local hasPending, minReadyAt = workspaceHasPending()
if hasPending then
  local sequence = redis.call('INCR', sequenceKey)
  local score = sequence
  if minReadyAt ~= nil and minReadyAt > now then
    score = minReadyAt * 1000000 + sequence
  end
  redis.call('ZADD', activeWorkspacesKey, score, workspaceId)
end

return cjson.encode({
  type = 'admitted',
  record = selectedRecord,
  leaseId = leaseId,
  leaseExpiresAt = leaseExpiresAt
})
`

function jobKey(jobId: string): string {
  return `${DISPATCH_PREFIX}:job:${jobId}`
}

function workspaceLaneKey(workspaceId: string, lane: WorkspaceDispatchLane): string {
  return `${DISPATCH_PREFIX}:workspace:${workspaceId}:lane:${lane}`
}

function workspaceLeaseKey(workspaceId: string): string {
  return `${DISPATCH_PREFIX}:workspace:${workspaceId}:leases`
}

function createPriorityScore(priority: number, sequence: number): number {
  return priority * 1_000_000_000_000 + sequence
}

export class RedisWorkspaceDispatchStorage implements WorkspaceDispatchStorageAdapter {
  constructor(private redis: Redis) {}

  private async nextSequence(): Promise<number> {
    return this.redis.incr(SEQUENCE_KEY)
  }

  async saveDispatchJob(record: WorkspaceDispatchJobRecord): Promise<void> {
    await this.redis.set(jobKey(record.id), JSON.stringify(record), 'EX', JOB_TTL_SECONDS)
  }

  async getDispatchJobRecord(jobId: string): Promise<WorkspaceDispatchJobRecord | null> {
    const raw = await this.redis.get(jobKey(jobId))
    if (!raw) {
      return null
    }

    try {
      return JSON.parse(raw) as WorkspaceDispatchJobRecord
    } catch (error) {
      logger.warn('Corrupted dispatch job record, deleting', { jobId, error })
      await this.redis.del(jobKey(jobId))
      return null
    }
  }

  async listDispatchJobsByStatuses(
    statuses: readonly WorkspaceDispatchJobRecord['status'][]
  ): Promise<WorkspaceDispatchJobRecord[]> {
    let cursor = '0'
    const jobs: WorkspaceDispatchJobRecord[] = []

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${DISPATCH_PREFIX}:job:*`,
        'COUNT',
        100
      )
      cursor = nextCursor

      if (keys.length === 0) {
        continue
      }

      const values = await this.redis.mget(...keys)
      for (const value of values) {
        if (!value) {
          continue
        }
        try {
          const record = JSON.parse(value) as WorkspaceDispatchJobRecord
          if (statuses.includes(record.status)) {
            jobs.push(record)
          }
        } catch {
          // Best effort during reconciliation scans.
        }
      }
    } while (cursor !== '0')

    return jobs
  }

  private static readonly TERMINAL_STATUSES = new Set(['completed', 'failed'])

  async updateDispatchJobRecord(
    jobId: string,
    updater: (record: WorkspaceDispatchJobRecord) => WorkspaceDispatchJobRecord
  ): Promise<WorkspaceDispatchJobRecord | null> {
    const current = await this.getDispatchJobRecord(jobId)
    if (!current) {
      return null
    }

    const updated = updater(current)
    if (
      RedisWorkspaceDispatchStorage.TERMINAL_STATUSES.has(current.status) &&
      !RedisWorkspaceDispatchStorage.TERMINAL_STATUSES.has(updated.status)
    ) {
      return current
    }

    await this.saveDispatchJob(updated)
    return updated
  }

  async enqueueWorkspaceDispatchJob(
    input: WorkspaceDispatchEnqueueInput
  ): Promise<WorkspaceDispatchJobRecord> {
    const id = input.id ?? `dispatch_${generateId().replace(/-/g, '').slice(0, 20)}`
    const createdAt = Date.now()
    const sequence = await this.nextSequence()

    const record: WorkspaceDispatchJobRecord = {
      id,
      workspaceId: input.workspaceId,
      lane: input.lane,
      queueName: input.queueName,
      bullmqJobName: input.bullmqJobName,
      bullmqPayload: input.bullmqPayload,
      metadata: input.metadata,
      priority: input.priority ?? 100,
      maxAttempts: input.maxAttempts,
      delayMs: input.delayMs,
      status: 'waiting',
      createdAt,
    }

    const score = createPriorityScore(record.priority, sequence)
    const pipeline = this.redis.pipeline()
    pipeline.set(jobKey(id), JSON.stringify(record), 'EX', JOB_TTL_SECONDS)
    pipeline.zadd(workspaceLaneKey(record.workspaceId, record.lane), score, id)
    pipeline.zadd(ACTIVE_WORKSPACES_KEY, 'NX', sequence, record.workspaceId)
    pipeline.incr(GLOBAL_DEPTH_KEY)
    await pipeline.exec()

    return record
  }

  async restoreWorkspaceDispatchJob(record: WorkspaceDispatchJobRecord): Promise<void> {
    const sequence = await this.nextSequence()
    const score = createPriorityScore(record.priority, sequence)
    const pipeline = this.redis.pipeline()
    pipeline.set(jobKey(record.id), JSON.stringify(record), 'EX', JOB_TTL_SECONDS)
    pipeline.zadd(workspaceLaneKey(record.workspaceId, record.lane), score, record.id)
    pipeline.zadd(ACTIVE_WORKSPACES_KEY, 'NX', sequence, record.workspaceId)
    await pipeline.exec()
  }

  async claimWorkspaceJob(
    workspaceId: string,
    options: {
      lanes: readonly WorkspaceDispatchLane[]
      concurrencyLimit: number
      leaseId: string
      now: number
      leaseTtlMs: number
    }
  ): Promise<WorkspaceDispatchClaimResult> {
    const raw = await this.redis.eval(
      CLAIM_JOB_SCRIPT,
      0,
      workspaceId,
      String(options.now),
      String(options.concurrencyLimit),
      options.leaseId,
      String(options.now + options.leaseTtlMs),
      JSON.stringify(options.lanes),
      SEQUENCE_KEY,
      ACTIVE_WORKSPACES_KEY,
      `${DISPATCH_PREFIX}:job:`,
      `${DISPATCH_PREFIX}:workspace:`,
      String(JOB_TTL_SECONDS)
    )

    const parsed = JSON.parse(String(raw)) as WorkspaceDispatchClaimResult
    switch (parsed.type) {
      case WORKSPACE_DISPATCH_CLAIM_RESULTS.ADMITTED:
      case WORKSPACE_DISPATCH_CLAIM_RESULTS.DELAYED:
      case WORKSPACE_DISPATCH_CLAIM_RESULTS.LIMIT_REACHED:
      case WORKSPACE_DISPATCH_CLAIM_RESULTS.EMPTY:
        return parsed
      default:
        throw new Error(
          `Unknown dispatch claim result: ${String((parsed as { type?: string }).type)}`
        )
    }
  }

  async getWorkspaceQueueDepth(
    workspaceId: string,
    lanes: readonly WorkspaceDispatchLane[]
  ): Promise<number> {
    if (lanes.length === 0) return 0
    const pipeline = this.redis.pipeline()
    for (const lane of lanes) {
      pipeline.zcard(workspaceLaneKey(workspaceId, lane))
    }
    const results = await pipeline.exec()
    let depth = 0
    for (const result of results ?? []) {
      if (result && !result[0]) {
        depth += (result[1] as number) ?? 0
      }
    }
    return depth
  }

  async getGlobalQueueDepth(): Promise<number> {
    const count = await this.redis.get(GLOBAL_DEPTH_KEY)
    return count ? Math.max(0, Number.parseInt(count, 10)) : 0
  }

  async reconcileGlobalQueueDepth(knownCount: number): Promise<void> {
    await this.redis.set(GLOBAL_DEPTH_KEY, knownCount)
  }

  async popNextWorkspaceId(): Promise<string | null> {
    const result = await this.redis.zpopmin(ACTIVE_WORKSPACES_KEY)
    if (!result || result.length === 0) {
      return null
    }

    return result[0] ?? null
  }

  async getQueuedWorkspaceCount(): Promise<number> {
    return this.redis.zcard(ACTIVE_WORKSPACES_KEY)
  }

  async hasActiveWorkspace(workspaceId: string): Promise<boolean> {
    return (await this.redis.zscore(ACTIVE_WORKSPACES_KEY, workspaceId)) !== null
  }

  async ensureWorkspaceActive(workspaceId: string, readyAt?: number): Promise<void> {
    const sequence = await this.nextSequence()
    const score = readyAt && readyAt > Date.now() ? readyAt * 1_000_000 + sequence : sequence
    await this.redis.zadd(ACTIVE_WORKSPACES_KEY, 'NX', score, workspaceId)
  }

  async requeueWorkspaceId(workspaceId: string): Promise<void> {
    const sequence = await this.nextSequence()
    await this.redis.zadd(ACTIVE_WORKSPACES_KEY, sequence, workspaceId)
  }

  async workspaceHasPendingJobs(
    workspaceId: string,
    lanes: readonly WorkspaceDispatchLane[]
  ): Promise<boolean> {
    for (const lane of lanes) {
      const count = await this.redis.zcard(workspaceLaneKey(workspaceId, lane))
      if (count > 0) {
        return true
      }
    }

    return false
  }

  async getNextWorkspaceJob(
    workspaceId: string,
    lanes: readonly WorkspaceDispatchLane[]
  ): Promise<WorkspaceDispatchJobRecord | null> {
    for (const lane of lanes) {
      const ids = await this.redis.zrange(workspaceLaneKey(workspaceId, lane), 0, 0)
      if (ids.length === 0) {
        continue
      }

      const record = await this.getDispatchJobRecord(ids[0])
      if (!record) {
        await this.redis.zrem(workspaceLaneKey(workspaceId, lane), ids[0])
        continue
      }

      return record
    }

    return null
  }

  async removeWorkspaceJobFromLane(
    workspaceId: string,
    lane: WorkspaceDispatchLane,
    jobId: string
  ): Promise<void> {
    await this.redis.zrem(workspaceLaneKey(workspaceId, lane), jobId)
  }

  async cleanupExpiredWorkspaceLeases(workspaceId: string): Promise<void> {
    await this.redis.zremrangebyscore(workspaceLeaseKey(workspaceId), 0, Date.now())
  }

  async countActiveWorkspaceLeases(workspaceId: string): Promise<number> {
    await this.cleanupExpiredWorkspaceLeases(workspaceId)
    return this.redis.zcard(workspaceLeaseKey(workspaceId))
  }

  async hasWorkspaceLease(workspaceId: string, leaseId: string): Promise<boolean> {
    await this.cleanupExpiredWorkspaceLeases(workspaceId)
    return (await this.redis.zscore(workspaceLeaseKey(workspaceId), leaseId)) !== null
  }

  async createWorkspaceLease(workspaceId: string, leaseId: string, ttlMs: number): Promise<number> {
    const expiresAt = Date.now() + ttlMs
    await this.redis.zadd(workspaceLeaseKey(workspaceId), expiresAt, leaseId)
    return expiresAt
  }

  async refreshWorkspaceLease(
    workspaceId: string,
    leaseId: string,
    ttlMs: number
  ): Promise<number> {
    return this.createWorkspaceLease(workspaceId, leaseId, ttlMs)
  }

  async releaseWorkspaceLease(workspaceId: string, leaseId: string): Promise<void> {
    await this.redis.zrem(workspaceLeaseKey(workspaceId), leaseId)
  }

  async removeWorkspaceIfIdle(
    workspaceId: string,
    lanes: readonly WorkspaceDispatchLane[]
  ): Promise<void> {
    const hasPendingJobs = await this.workspaceHasPendingJobs(workspaceId, lanes)
    if (!hasPendingJobs) {
      await this.redis.zrem(ACTIVE_WORKSPACES_KEY, workspaceId)
    }
  }

  async markDispatchJobAdmitted(
    jobId: string,
    workspaceId: string,
    leaseId: string,
    leaseExpiresAt: number
  ): Promise<void> {
    await this.updateDispatchJobRecord(jobId, (record) => ({
      ...record,
      status: 'admitted',
      admittedAt: Date.now(),
      lease: {
        workspaceId,
        leaseId,
      },
      metadata: {
        ...record.metadata,
        dispatchLeaseExpiresAt: leaseExpiresAt,
      },
    }))
  }

  async markDispatchJobAdmitting(
    jobId: string,
    workspaceId: string,
    leaseId: string,
    leaseExpiresAt: number
  ): Promise<void> {
    await this.updateDispatchJobRecord(jobId, (record) => ({
      ...record,
      status: 'admitting',
      lease: {
        workspaceId,
        leaseId,
      },
      metadata: {
        ...record.metadata,
        dispatchLeaseExpiresAt: leaseExpiresAt,
      },
    }))
  }

  async markDispatchJobRunning(jobId: string): Promise<void> {
    await this.updateDispatchJobRecord(jobId, (record) => ({
      ...record,
      status: 'running',
      startedAt: record.startedAt ?? Date.now(),
    }))
  }

  async markDispatchJobCompleted(jobId: string, output: unknown): Promise<void> {
    await this.updateDispatchJobRecord(jobId, (record) => ({
      ...record,
      status: 'completed',
      completedAt: Date.now(),
      output,
    }))
    await this.redis.decr(GLOBAL_DEPTH_KEY).catch(() => undefined)
  }

  async markDispatchJobFailed(jobId: string, error: string): Promise<void> {
    await this.updateDispatchJobRecord(jobId, (record) => ({
      ...record,
      status: 'failed',
      completedAt: Date.now(),
      error,
    }))
    await this.redis.decr(GLOBAL_DEPTH_KEY).catch(() => undefined)
  }

  async clear(): Promise<void> {
    let cursor = '0'
    const keys: string[] = []

    do {
      const [nextCursor, foundKeys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${DISPATCH_PREFIX}:*`,
        'COUNT',
        100
      )
      cursor = nextCursor
      keys.push(...foundKeys)
    } while (cursor !== '0')

    if (keys.length > 0) {
      await this.redis.del(...keys)
    }
  }

  dispose(): void {
    logger.info('Redis workspace dispatch storage disposed')
  }
}
