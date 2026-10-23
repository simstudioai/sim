import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { isRecordLike } from '@sim/utils/object'

const MAX_FILE_BYTES = 8_192
const MAX_SAMPLE_AGE_MS = 30_000
const MAX_FUTURE_SKEW_MS = 1_000

export interface SearchRetirementHealthLimits {
  databaseId: string
  maxReplicaLagBytes: number
  maxReplicaLagSeconds: number
  maxWalBytesPerSecond: number
  maxDatabaseP95Ms: number
  maxCpuPercent: number
  minFreeStorageBytes: number
  maxSampleAgeMs: number
}

interface SearchRetirementHealthSample {
  observedAt: string
  databaseId: string
  healthy: boolean
  replicaLagBytes: number
  replicaLagSeconds: number
  walBytesPerSecond: number
  databaseP95Ms: number
  cpuPercent: number
  freeStorageBytes: number
  maintenanceAllowed: boolean
  cutoverAllowed: boolean
}

type HealthRefusalReason =
  | 'health_file_unreadable'
  | 'health_file_too_large'
  | 'health_file_changed'
  | 'invalid_sample'
  | 'invalid_limits'
  | 'identity_mismatch'
  | 'stale_sample'
  | 'future_sample'
  | 'unhealthy'
  | 'maintenance_refused'
  | 'cutover_refused'
  | 'replica_lag_bytes'
  | 'replica_lag_seconds'
  | 'wal_rate'
  | 'database_latency'
  | 'cpu_usage'
  | 'storage_headroom'

/** A safe refusal reason that never includes operator paths, database identity, or sample values. */
export class RetireSearchHealthError extends Error {
  constructor(readonly reason: HealthRefusalReason) {
    super(`Search retirement health gate refused: ${reason}`)
    this.name = 'RetireSearchHealthError'
  }
}

const SAMPLE_FIELDS = [
  'observedAt',
  'databaseId',
  'healthy',
  'replicaLagBytes',
  'replicaLagSeconds',
  'walBytesPerSecond',
  'databaseP95Ms',
  'cpuPercent',
  'freeStorageBytes',
  'maintenanceAllowed',
  'cutoverAllowed',
] as const

const LIMIT_FIELDS = [
  'databaseId',
  'maxReplicaLagBytes',
  'maxReplicaLagSeconds',
  'maxWalBytesPerSecond',
  'maxDatabaseP95Ms',
  'maxCpuPercent',
  'minFreeStorageBytes',
  'maxSampleAgeMs',
] as const

function isNonnegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isPositiveFinite(value: unknown): value is number {
  return isNonnegativeFinite(value) && value > 0
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).length === fields.length && fields.every((field) => field in value)
}

function assertLimits(value: unknown): asserts value is SearchRetirementHealthLimits {
  if (
    !isRecordLike(value) ||
    !hasExactFields(value, LIMIT_FIELDS) ||
    typeof value.databaseId !== 'string' ||
    value.databaseId.trim().length === 0 ||
    !isNonnegativeFinite(value.maxReplicaLagBytes) ||
    !isNonnegativeFinite(value.maxReplicaLagSeconds) ||
    !isPositiveFinite(value.maxWalBytesPerSecond) ||
    !isPositiveFinite(value.maxDatabaseP95Ms) ||
    !isPositiveFinite(value.maxCpuPercent) ||
    value.maxCpuPercent > 100 ||
    !isPositiveFinite(value.minFreeStorageBytes) ||
    !isPositiveFinite(value.maxSampleAgeMs) ||
    value.maxSampleAgeMs > MAX_SAMPLE_AGE_MS
  ) {
    throw new RetireSearchHealthError('invalid_limits')
  }
}

function assertSample(value: unknown): asserts value is SearchRetirementHealthSample {
  if (
    !isRecordLike(value) ||
    !hasExactFields(value, SAMPLE_FIELDS) ||
    typeof value.observedAt !== 'string' ||
    typeof value.databaseId !== 'string' ||
    value.databaseId.trim().length === 0 ||
    typeof value.healthy !== 'boolean' ||
    typeof value.maintenanceAllowed !== 'boolean' ||
    typeof value.cutoverAllowed !== 'boolean' ||
    !isNonnegativeFinite(value.replicaLagBytes) ||
    !isNonnegativeFinite(value.replicaLagSeconds) ||
    !isNonnegativeFinite(value.walBytesPerSecond) ||
    !isNonnegativeFinite(value.databaseP95Ms) ||
    !isNonnegativeFinite(value.cpuPercent) ||
    !isNonnegativeFinite(value.freeStorageBytes)
  ) {
    throw new RetireSearchHealthError('invalid_sample')
  }
}

async function readBoundedJson(
  path: string,
  invalidReason: 'invalid_sample' | 'invalid_limits'
): Promise<unknown> {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
    try {
      const before = await file.stat()
      if (!before.isFile()) throw new RetireSearchHealthError('health_file_unreadable')
      if (before.size > MAX_FILE_BYTES) throw new RetireSearchHealthError('health_file_too_large')

      const bytes = Buffer.alloc(MAX_FILE_BYTES)
      let length = 0
      while (length < bytes.length) {
        const read = await file.read(bytes, length, bytes.length - length, length)
        if (read.bytesRead === 0) break
        length += read.bytesRead
      }

      const after = await file.stat()
      if (after.size > MAX_FILE_BYTES) throw new RetireSearchHealthError('health_file_too_large')
      if (
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        length !== after.size
      ) {
        throw new RetireSearchHealthError('health_file_changed')
      }

      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))
        const value: unknown = JSON.parse(text)
        return value
      } catch {
        throw new RetireSearchHealthError(invalidReason)
      }
    } finally {
      await file.close()
    }
  } catch (error) {
    if (error instanceof RetireSearchHealthError) throw error
    throw new RetireSearchHealthError('health_file_unreadable')
  }
}

/** Reads and validates the operator's bounded policy file without exposing its contents in errors. */
export async function readSearchRetirementHealthLimits(
  path: string
): Promise<SearchRetirementHealthLimits> {
  const limits = await readBoundedJson(path, 'invalid_limits')
  assertLimits(limits)
  return limits
}

/** Reads a fresh external health sample before one bounded maintenance page; unknown health refuses work. */
export async function readSearchRetirementHealth(
  path: string,
  limits: SearchRetirementHealthLimits,
  options: { cutover?: boolean } = {}
): Promise<number> {
  assertLimits(limits)
  const sample = await readBoundedJson(path, 'invalid_sample')
  assertSample(sample)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(sample.observedAt)) {
    throw new RetireSearchHealthError('invalid_sample')
  }
  const observedAt = Date.parse(sample.observedAt)
  const canonicalTimestamp = sample.observedAt.includes('.')
    ? sample.observedAt
    : sample.observedAt.replace('Z', '.000Z')
  if (!Number.isFinite(observedAt) || new Date(observedAt).toISOString() !== canonicalTimestamp) {
    throw new RetireSearchHealthError('invalid_sample')
  }
  if (sample.databaseId !== limits.databaseId)
    throw new RetireSearchHealthError('identity_mismatch')
  const age = Date.now() - observedAt
  if (age < -MAX_FUTURE_SKEW_MS) throw new RetireSearchHealthError('future_sample')
  if (age > limits.maxSampleAgeMs) throw new RetireSearchHealthError('stale_sample')
  if (!sample.healthy) throw new RetireSearchHealthError('unhealthy')
  if (!sample.maintenanceAllowed) throw new RetireSearchHealthError('maintenance_refused')
  if (options.cutover && !sample.cutoverAllowed)
    throw new RetireSearchHealthError('cutover_refused')
  if (sample.replicaLagBytes > limits.maxReplicaLagBytes) {
    throw new RetireSearchHealthError('replica_lag_bytes')
  }
  if (sample.replicaLagSeconds > limits.maxReplicaLagSeconds) {
    throw new RetireSearchHealthError('replica_lag_seconds')
  }
  if (sample.walBytesPerSecond > limits.maxWalBytesPerSecond) {
    throw new RetireSearchHealthError('wal_rate')
  }
  if (sample.databaseP95Ms > limits.maxDatabaseP95Ms) {
    throw new RetireSearchHealthError('database_latency')
  }
  if (sample.cpuPercent > limits.maxCpuPercent) throw new RetireSearchHealthError('cpu_usage')
  if (sample.freeStorageBytes < limits.minFreeStorageBytes) {
    throw new RetireSearchHealthError('storage_headroom')
  }
  return observedAt
}
