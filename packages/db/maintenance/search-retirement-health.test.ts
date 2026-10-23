import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  RetireSearchHealthError,
  readSearchRetirementHealth,
  readSearchRetirementHealthLimits,
  type SearchRetirementHealthLimits,
} from '@sim/db/maintenance/search-retirement-health'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const NOW = Date.parse('2026-10-01T12:00:00.000Z')
const LIMITS: SearchRetirementHealthLimits = {
  databaseId: 'test-database',
  maxReplicaLagBytes: 1_000,
  maxReplicaLagSeconds: 2,
  maxWalBytesPerSecond: 2_000,
  maxDatabaseP95Ms: 100,
  maxCpuPercent: 50,
  minFreeStorageBytes: 5_000,
  maxSampleAgeMs: 10_000,
}
const SAMPLE = {
  observedAt: '2026-10-01T12:00:00.000Z',
  databaseId: 'test-database',
  healthy: true,
  replicaLagBytes: 0,
  replicaLagSeconds: 0,
  walBytesPerSecond: 100,
  databaseP95Ms: 10,
  cpuPercent: 10,
  freeStorageBytes: 10_000,
  maintenanceAllowed: true,
  cutoverAllowed: false,
}

describe('Search retirement external health gate', () => {
  let directory: string
  let path: string

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    directory = await mkdtemp(join(tmpdir(), 'search-retirement-health-'))
    path = join(directory, 'health.json')
    await writeFile(path, JSON.stringify(SAMPLE))
  })

  afterEach(async () => {
    vi.useRealTimers()
    await rm(directory, { recursive: true, force: true })
  })

  it('reads a replacement sample before allowing another page', async () => {
    expect(await readSearchRetirementHealth(path, LIMITS)).toBe(NOW)
    await writeFile(path, JSON.stringify({ ...SAMPLE, maintenanceAllowed: false }))
    await expect(readSearchRetirementHealth(path, LIMITS)).rejects.toMatchObject({
      reason: 'maintenance_refused',
    })
  })

  it('requires separate cutover approval while allowing ordinary maintenance', async () => {
    expect(await readSearchRetirementHealth(path, LIMITS)).toBe(NOW)
    await expect(readSearchRetirementHealth(path, LIMITS, { cutover: true })).rejects.toMatchObject(
      {
        reason: 'cutover_refused',
      }
    )
    await writeFile(path, JSON.stringify({ ...SAMPLE, cutoverAllowed: true }))
    expect(await readSearchRetirementHealth(path, LIMITS, { cutover: true })).toBe(NOW)
  })

  it('rejects an operator CPU ceiling above one hundred percent', async () => {
    await writeFile(path, JSON.stringify({ ...LIMITS, maxCpuPercent: 100.001 }))
    await expect(readSearchRetirementHealthLimits(path)).rejects.toMatchObject({
      reason: 'invalid_limits',
    })
  })

  it.each(['missing', 'directory'] as const)('rejects a %s health file', async (kind) => {
    await expect(
      readSearchRetirementHealth(kind === 'missing' ? join(directory, 'absent') : directory, LIMITS)
    ).rejects.toBeInstanceOf(RetireSearchHealthError)
  })

  it('accepts at most eight KiB, including UTF-8 bytes and trailing whitespace', async () => {
    const encoded = JSON.stringify(SAMPLE)
    await writeFile(path, encoded.padEnd(8_192, ' '))
    expect(await readSearchRetirementHealth(path, LIMITS)).toBe(NOW)
    await writeFile(path, encoded.padEnd(8_193, ' '))
    await expect(readSearchRetirementHealth(path, LIMITS)).rejects.toMatchObject({
      reason: 'health_file_too_large',
    })
    await writeFile(path, JSON.stringify({ ...SAMPLE, padding: 'é'.repeat(4_096) }))
    await expect(readSearchRetirementHealth(path, LIMITS)).rejects.toMatchObject({
      reason: 'health_file_too_large',
    })
  })

  it.each(['', '{', 'null', '[]', 'true', '{"observedAt":123}'])(
    'rejects malformed or incomplete wire content: %s',
    async (content) => {
      await writeFile(path, content)
      await expect(readSearchRetirementHealth(path, LIMITS)).rejects.toMatchObject({
        reason: 'invalid_sample',
      })
    }
  )

  it('rejects invalid UTF-8 instead of substituting a replacement character', async () => {
    const encoded = Buffer.from(JSON.stringify(SAMPLE))
    const location = encoded.indexOf('test-database')
    encoded[location] = 0xff
    await writeFile(path, encoded)
    await expect(readSearchRetirementHealth(path, LIMITS)).rejects.toMatchObject({
      reason: 'invalid_sample',
    })
  })

  it.each([
    { healthy: 'true' },
    { maintenanceAllowed: 1 },
    { cutoverAllowed: 'true' },
    { cutoverAllowed: undefined },
    { databaseId: '' },
    { unexpected: true },
    { observedAt: null },
    { replicaLagBytes: -1 },
    { replicaLagSeconds: null },
    { walBytesPerSecond: '100' },
    { databaseP95Ms: -1 },
    { cpuPercent: null },
    { freeStorageBytes: -1 },
  ])('rejects malformed sample field %j', async (fields) => {
    await writeFile(path, JSON.stringify({ ...SAMPLE, ...fields }))
    await expect(readSearchRetirementHealth(path, LIMITS)).rejects.toMatchObject({
      reason: 'invalid_sample',
    })
  })

  it('rejects a nonfinite JSON number', async () => {
    await writeFile(
      path,
      JSON.stringify(SAMPLE).replace('"replicaLagBytes":0', '"replicaLagBytes":1e999')
    )
    await expect(readSearchRetirementHealth(path, LIMITS)).rejects.toMatchObject({
      reason: 'invalid_sample',
    })
  })

  it.each([
    '2026-10-01T12:00:00+00:00',
    '2026-10-01 12:00:00Z',
    '2026-02-30T12:00:00.000Z',
    '2026-10-01T24:00:00.000Z',
  ])('rejects a noncanonical or impossible UTC timestamp: %s', async (observedAt) => {
    await writeFile(path, JSON.stringify({ ...SAMPLE, observedAt }))
    await expect(readSearchRetirementHealth(path, LIMITS)).rejects.toMatchObject({
      reason: 'invalid_sample',
    })
  })

  it.each([
    ['2026-10-01T11:59:49.999Z', 'stale_sample'],
    ['2026-10-01T12:00:01.001Z', 'future_sample'],
  ])('rejects a sample outside the time budget: %s', async (observedAt, reason) => {
    await writeFile(path, JSON.stringify({ ...SAMPLE, observedAt }))
    await expect(readSearchRetirementHealth(path, LIMITS)).rejects.toMatchObject({ reason })
  })

  it('does not reuse a previously fresh sample once it expires', async () => {
    await readSearchRetirementHealth(path, LIMITS)
    vi.setSystemTime(NOW + LIMITS.maxSampleAgeMs + 1)
    await expect(readSearchRetirementHealth(path, LIMITS)).rejects.toMatchObject({
      reason: 'stale_sample',
    })
  })

  it.each([
    [{ databaseId: 'other-database' }, 'identity_mismatch'],
    [{ healthy: false }, 'unhealthy'],
    [{ maintenanceAllowed: false }, 'maintenance_refused'],
    [{ replicaLagBytes: 1_001 }, 'replica_lag_bytes'],
    [{ replicaLagSeconds: 2.001 }, 'replica_lag_seconds'],
    [{ walBytesPerSecond: 2_001 }, 'wal_rate'],
    [{ databaseP95Ms: 101 }, 'database_latency'],
    [{ cpuPercent: 51 }, 'cpu_usage'],
    [{ freeStorageBytes: 4_999 }, 'storage_headroom'],
  ] as const)('refuses unsafe sample %j', async (fields, reason) => {
    await writeFile(path, JSON.stringify({ ...SAMPLE, ...fields }))
    await expect(readSearchRetirementHealth(path, LIMITS)).rejects.toMatchObject({ reason })
  })

  it('permits zero-lag limits and refuses any replication debt', async () => {
    const limits = { ...LIMITS, maxReplicaLagBytes: 0, maxReplicaLagSeconds: 0 }
    await readSearchRetirementHealth(path, limits)
    await writeFile(path, JSON.stringify({ ...SAMPLE, replicaLagBytes: 1 }))
    await expect(readSearchRetirementHealth(path, limits)).rejects.toMatchObject({
      reason: 'replica_lag_bytes',
    })
  })

  it.each([
    { databaseId: '' },
    { maxReplicaLagBytes: -1 },
    { maxReplicaLagSeconds: Number.NaN },
    { maxWalBytesPerSecond: 0 },
    { maxDatabaseP95Ms: Number.POSITIVE_INFINITY },
    { maxCpuPercent: 0 },
    { minFreeStorageBytes: 0 },
    { maxSampleAgeMs: 0 },
    { maxSampleAgeMs: 30_001 },
  ])('rejects limits that disable a guard: %j', async (fields) => {
    await expect(readSearchRetirementHealth(path, { ...LIMITS, ...fields })).rejects.toMatchObject({
      reason: 'invalid_limits',
    })
    await writeFile(path, JSON.stringify({ ...LIMITS, ...fields }))
    await expect(readSearchRetirementHealthLimits(path)).rejects.toMatchObject({
      reason: 'invalid_limits',
    })
  })

  it('loads the bounded operator policy and enforces it against the health sample', async () => {
    const policyPath = join(directory, 'policy.json')
    await writeFile(policyPath, JSON.stringify({ ...LIMITS, maxReplicaLagBytes: 0 }))
    const limits = await readSearchRetirementHealthLimits(policyPath)
    await writeFile(path, JSON.stringify({ ...SAMPLE, replicaLagBytes: 1 }))
    await expect(readSearchRetirementHealth(path, limits)).rejects.toMatchObject({
      reason: 'replica_lag_bytes',
    })
  })

  it.each(['{}', 'null', '{', JSON.stringify({ ...LIMITS, unexpected: true })])(
    'rejects malformed operator policy content: %s',
    async (content) => {
      await writeFile(path, content)
      await expect(readSearchRetirementHealthLimits(path)).rejects.toMatchObject({
        reason: 'invalid_limits',
      })
    }
  )

  it('enforces the same eight-KiB cap on operator policies', async () => {
    await writeFile(path, JSON.stringify(LIMITS).padEnd(8_193, ' '))
    await expect(readSearchRetirementHealthLimits(path)).rejects.toMatchObject({
      reason: 'health_file_too_large',
    })
  })

  it('returns only typed generic reasons for payload and filesystem failures', async () => {
    const privateMarker = 'private-operator-marker'
    await writeFile(path, JSON.stringify({ ...SAMPLE, databaseId: privateMarker }))
    for (const candidate of [path, join(directory, privateMarker)]) {
      try {
        await readSearchRetirementHealth(candidate, LIMITS)
        expect.fail('The health gate should refuse this sample')
      } catch (error) {
        expect(error).toBeInstanceOf(RetireSearchHealthError)
        if (!(error instanceof RetireSearchHealthError)) throw error
        expect(error.message).not.toContain(privateMarker)
        expect(error.message).not.toContain(directory)
        expect(error.cause).toBeUndefined()
      }
    }
  })
})
