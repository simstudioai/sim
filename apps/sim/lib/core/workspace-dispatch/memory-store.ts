import { createLogger } from '@sim/logger'
import type { WorkspaceDispatchStorageAdapter } from '@/lib/core/workspace-dispatch/adapter'
import {
  WORKSPACE_DISPATCH_CLAIM_RESULTS,
  type WorkspaceDispatchClaimResult,
  type WorkspaceDispatchEnqueueInput,
  type WorkspaceDispatchJobRecord,
  type WorkspaceDispatchLane,
} from '@/lib/core/workspace-dispatch/types'

const logger = createLogger('WorkspaceDispatchMemoryStore')
const JOB_TTL_MS = 48 * 60 * 60 * 1000

export class MemoryWorkspaceDispatchStorage implements WorkspaceDispatchStorageAdapter {
  private jobs = new Map<string, WorkspaceDispatchJobRecord>()
  private workspaceOrder: string[] = []
  private laneQueues = new Map<string, string[]>()
  private leases = new Map<string, Map<string, number>>()
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor() {
    this.cleanupInterval = setInterval(() => {
      void this.clearExpiredState()
    }, 60_000)
    this.cleanupInterval.unref()
  }

  private queueKey(workspaceId: string, lane: WorkspaceDispatchLane): string {
    return `${workspaceId}:${lane}`
  }

  private ensureWorkspaceQueued(workspaceId: string): void {
    if (!this.workspaceOrder.includes(workspaceId)) {
      this.workspaceOrder.push(workspaceId)
    }
  }

  private getLaneQueue(workspaceId: string, lane: WorkspaceDispatchLane): string[] {
    const key = this.queueKey(workspaceId, lane)
    const existing = this.laneQueues.get(key)
    if (existing) {
      return existing
    }

    const queue: string[] = []
    this.laneQueues.set(key, queue)
    return queue
  }

  private sortQueue(queue: string[]): void {
    queue.sort((leftId, rightId) => {
      const left = this.jobs.get(leftId)
      const right = this.jobs.get(rightId)
      if (!left || !right) {
        return 0
      }

      if (left.priority !== right.priority) {
        return left.priority - right.priority
      }

      return left.createdAt - right.createdAt
    })
  }

  private getLeaseMap(workspaceId: string): Map<string, number> {
    const existing = this.leases.get(workspaceId)
    if (existing) {
      return existing
    }

    const leaseMap = new Map<string, number>()
    this.leases.set(workspaceId, leaseMap)
    return leaseMap
  }

  private async clearExpiredState(): Promise<void> {
    const now = Date.now()

    for (const [jobId, record] of this.jobs.entries()) {
      if (
        (record.status === 'completed' || record.status === 'failed') &&
        record.completedAt &&
        now - record.completedAt > JOB_TTL_MS
      ) {
        this.jobs.delete(jobId)
      }
    }

    for (const [workspaceId, leaseMap] of this.leases.entries()) {
      for (const [leaseId, expiresAt] of leaseMap.entries()) {
        if (expiresAt <= now) {
          leaseMap.delete(leaseId)
        }
      }
      if (leaseMap.size === 0) {
        this.leases.delete(workspaceId)
      }
    }
  }

  async saveDispatchJob(record: WorkspaceDispatchJobRecord): Promise<void> {
    this.jobs.set(record.id, record)
  }

  async getDispatchJobRecord(jobId: string): Promise<WorkspaceDispatchJobRecord | null> {
    return this.jobs.get(jobId) ?? null
  }

  async listDispatchJobsByStatuses(
    statuses: readonly WorkspaceDispatchJobRecord['status'][]
  ): Promise<WorkspaceDispatchJobRecord[]> {
    return Array.from(this.jobs.values()).filter((record) => statuses.includes(record.status))
  }

  private static readonly TERMINAL_STATUSES = new Set(['completed', 'failed'])

  async updateDispatchJobRecord(
    jobId: string,
    updater: (record: WorkspaceDispatchJobRecord) => WorkspaceDispatchJobRecord
  ): Promise<WorkspaceDispatchJobRecord | null> {
    const current = this.jobs.get(jobId)
    if (!current) {
      return null
    }

    const updated = updater(current)
    if (
      MemoryWorkspaceDispatchStorage.TERMINAL_STATUSES.has(current.status) &&
      !MemoryWorkspaceDispatchStorage.TERMINAL_STATUSES.has(updated.status)
    ) {
      return current
    }

    this.jobs.set(jobId, updated)
    return updated
  }

  async enqueueWorkspaceDispatchJob(
    input: WorkspaceDispatchEnqueueInput
  ): Promise<WorkspaceDispatchJobRecord> {
    const id = input.id ?? `dispatch_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
    const createdAt = Date.now()

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

    this.jobs.set(id, record)
    const queue = this.getLaneQueue(record.workspaceId, record.lane)
    queue.push(id)
    this.sortQueue(queue)
    this.ensureWorkspaceQueued(record.workspaceId)
    return record
  }

  async restoreWorkspaceDispatchJob(record: WorkspaceDispatchJobRecord): Promise<void> {
    this.jobs.set(record.id, record)
    const queue = this.getLaneQueue(record.workspaceId, record.lane)
    if (!queue.includes(record.id)) {
      queue.push(record.id)
      this.sortQueue(queue)
    }
    this.ensureWorkspaceQueued(record.workspaceId)
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
    await this.cleanupExpiredWorkspaceLeases(workspaceId)
    if (this.getLeaseMap(workspaceId).size >= options.concurrencyLimit) {
      this.ensureWorkspaceQueued(workspaceId)
      return { type: WORKSPACE_DISPATCH_CLAIM_RESULTS.LIMIT_REACHED }
    }

    let selectedRecord: WorkspaceDispatchJobRecord | null = null
    let selectedLane: WorkspaceDispatchLane | null = null
    let nextReadyAt: number | null = null

    for (const lane of options.lanes) {
      const queue = this.getLaneQueue(workspaceId, lane)
      for (let scanIndex = 0; scanIndex < queue.length && scanIndex < 20; ) {
        const jobId = queue[scanIndex]
        const record = this.jobs.get(jobId)
        if (!record) {
          queue.splice(scanIndex, 1)
          continue
        }

        const readyAt = record.createdAt + (record.delayMs ?? 0)
        if (readyAt <= options.now) {
          selectedRecord = record
          selectedLane = lane
          queue.splice(scanIndex, 1)
          break
        }

        nextReadyAt = nextReadyAt ? Math.min(nextReadyAt, readyAt) : readyAt
        scanIndex++
      }

      if (selectedRecord) {
        break
      }
    }

    if (!selectedRecord || !selectedLane) {
      const hasPending = await this.workspaceHasPendingJobs(workspaceId, options.lanes)
      if (!hasPending) {
        this.workspaceOrder = this.workspaceOrder.filter((value) => value !== workspaceId)
        return { type: WORKSPACE_DISPATCH_CLAIM_RESULTS.EMPTY }
      }

      this.ensureWorkspaceQueued(workspaceId)
      return {
        type: WORKSPACE_DISPATCH_CLAIM_RESULTS.DELAYED,
        nextReadyAt: nextReadyAt ?? options.now,
      }
    }

    const leaseExpiresAt = options.now + options.leaseTtlMs
    this.getLeaseMap(workspaceId).set(options.leaseId, leaseExpiresAt)

    const updatedRecord: WorkspaceDispatchJobRecord = {
      ...selectedRecord,
      status: 'admitting',
      lease: {
        workspaceId,
        leaseId: options.leaseId,
      },
      metadata: {
        ...selectedRecord.metadata,
        dispatchLeaseExpiresAt: leaseExpiresAt,
      },
    }
    this.jobs.set(updatedRecord.id, updatedRecord)

    const hasPending = await this.workspaceHasPendingJobs(workspaceId, options.lanes)
    if (hasPending) {
      this.ensureWorkspaceQueued(workspaceId)
    } else {
      this.workspaceOrder = this.workspaceOrder.filter((value) => value !== workspaceId)
    }

    return {
      type: WORKSPACE_DISPATCH_CLAIM_RESULTS.ADMITTED,
      record: updatedRecord,
      leaseId: options.leaseId,
      leaseExpiresAt,
    }
  }

  async getWorkspaceQueueDepth(
    workspaceId: string,
    lanes: readonly WorkspaceDispatchLane[]
  ): Promise<number> {
    let depth = 0
    for (const lane of lanes) {
      depth += this.getLaneQueue(workspaceId, lane).length
    }
    return depth
  }

  async getGlobalQueueDepth(): Promise<number> {
    const terminalStatuses = new Set(['completed', 'failed'])
    let count = 0
    for (const job of this.jobs.values()) {
      if (!terminalStatuses.has(job.status)) {
        count++
      }
    }
    return count
  }

  async reconcileGlobalQueueDepth(_knownCount: number): Promise<void> {
    // no-op: memory store computes depth on the fly
  }

  async popNextWorkspaceId(): Promise<string | null> {
    const now = Date.now()
    const maxScans = this.workspaceOrder.length
    for (let i = 0; i < maxScans; i++) {
      const id = this.workspaceOrder.shift()
      if (!id) return null
      const readyAt = this.workspaceReadyAt.get(id)
      if (readyAt && readyAt > now) {
        this.workspaceOrder.push(id)
        continue
      }
      this.workspaceReadyAt.delete(id)
      return id
    }
    return null
  }

  async getQueuedWorkspaceCount(): Promise<number> {
    return this.workspaceOrder.length
  }

  async hasActiveWorkspace(workspaceId: string): Promise<boolean> {
    return this.workspaceOrder.includes(workspaceId)
  }

  private workspaceReadyAt = new Map<string, number>()

  async ensureWorkspaceActive(workspaceId: string, readyAt?: number): Promise<void> {
    if (readyAt && readyAt > Date.now()) {
      this.workspaceReadyAt.set(workspaceId, readyAt)
    }
    this.ensureWorkspaceQueued(workspaceId)
  }

  async requeueWorkspaceId(workspaceId: string): Promise<void> {
    this.ensureWorkspaceQueued(workspaceId)
  }

  async workspaceHasPendingJobs(
    workspaceId: string,
    lanes: readonly WorkspaceDispatchLane[]
  ): Promise<boolean> {
    return lanes.some((lane) => this.getLaneQueue(workspaceId, lane).length > 0)
  }

  async getNextWorkspaceJob(
    workspaceId: string,
    lanes: readonly WorkspaceDispatchLane[]
  ): Promise<WorkspaceDispatchJobRecord | null> {
    for (const lane of lanes) {
      const queue = this.getLaneQueue(workspaceId, lane)
      while (queue.length > 0) {
        const jobId = queue[0]
        const job = this.jobs.get(jobId)
        if (job) {
          return job
        }
        queue.shift()
      }
    }

    return null
  }

  async removeWorkspaceJobFromLane(
    workspaceId: string,
    lane: WorkspaceDispatchLane,
    jobId: string
  ): Promise<void> {
    const queue = this.getLaneQueue(workspaceId, lane)
    const index = queue.indexOf(jobId)
    if (index >= 0) {
      queue.splice(index, 1)
    }
  }

  async cleanupExpiredWorkspaceLeases(workspaceId: string): Promise<void> {
    const leaseMap = this.getLeaseMap(workspaceId)
    const now = Date.now()
    for (const [leaseId, expiresAt] of leaseMap.entries()) {
      if (expiresAt <= now) {
        leaseMap.delete(leaseId)
      }
    }
  }

  async countActiveWorkspaceLeases(workspaceId: string): Promise<number> {
    await this.cleanupExpiredWorkspaceLeases(workspaceId)
    return this.getLeaseMap(workspaceId).size
  }

  async hasWorkspaceLease(workspaceId: string, leaseId: string): Promise<boolean> {
    await this.cleanupExpiredWorkspaceLeases(workspaceId)
    return this.getLeaseMap(workspaceId).has(leaseId)
  }

  async createWorkspaceLease(workspaceId: string, leaseId: string, ttlMs: number): Promise<number> {
    const expiresAt = Date.now() + ttlMs
    this.getLeaseMap(workspaceId).set(leaseId, expiresAt)
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
    this.getLeaseMap(workspaceId).delete(leaseId)
  }

  async removeWorkspaceIfIdle(
    workspaceId: string,
    lanes: readonly WorkspaceDispatchLane[]
  ): Promise<void> {
    const hasPending = await this.workspaceHasPendingJobs(workspaceId, lanes)
    if (!hasPending) {
      this.workspaceOrder = this.workspaceOrder.filter((value) => value !== workspaceId)
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
  }

  async markDispatchJobFailed(jobId: string, error: string): Promise<void> {
    await this.updateDispatchJobRecord(jobId, (record) => ({
      ...record,
      status: 'failed',
      completedAt: Date.now(),
      error,
    }))
  }

  async clear(): Promise<void> {
    this.jobs.clear()
    this.workspaceOrder = []
    this.laneQueues.clear()
    this.leases.clear()
    this.workspaceReadyAt.clear()
  }

  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    void this.clear().catch((error) => {
      logger.error('Failed to clear memory workspace dispatch storage', { error })
    })
  }
}
