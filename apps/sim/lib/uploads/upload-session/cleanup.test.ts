/**
 * @vitest-environment node
 */
import { mkdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { testUploadDirectory } = vi.hoisted(() => ({
  testUploadDirectory: `/tmp/sim-upload-session-cleanup-${process.pid}`,
}))

vi.mock('@/lib/uploads/core/setup.server', () => ({
  UPLOAD_DIR_SERVER: testUploadDirectory,
}))

import {
  LOCAL_UPLOAD_ARTIFACT_TTL_MS,
  maybeCleanupLocalUploadArtifacts,
  resetLocalUploadCleanupForTesting,
  sweepLocalUploadArtifacts,
} from '@/lib/uploads/upload-session/cleanup'

describe('local upload artifact cleanup', () => {
  beforeEach(async () => {
    resetLocalUploadCleanupForTesting()
    await rm(testUploadDirectory, { recursive: true, force: true })
    await mkdir(testUploadDirectory, { recursive: true })
  })

  it('removes expired multipart entries while retaining fresh entries', async () => {
    const now = Date.UTC(2026, 7, 4, 12)
    await createArtifact('.multipart/expired', now - LOCAL_UPLOAD_ARTIFACT_TTL_MS - 1)
    await createArtifact('.multipart/fresh', now)

    await expect(sweepLocalUploadArtifacts({ now })).resolves.toEqual({ scanned: 2, removed: 1 })
    await expect(stat(`${testUploadDirectory}/.multipart/expired`)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(stat(`${testUploadDirectory}/.multipart/fresh`)).resolves.toBeDefined()
  })

  // A PUT or multipart assembly that dies mid-write leaves a staged object
  // behind, so staging lives under a sweep root rather than beside its
  // destination.
  it('reclaims abandoned staged objects', async () => {
    const now = Date.UTC(2026, 7, 4, 12)
    await createStagedObject('abandoned.tmp', now - LOCAL_UPLOAD_ARTIFACT_TTL_MS - 1)
    await createStagedObject('in-flight.tmp', now)

    await expect(sweepLocalUploadArtifacts({ now })).resolves.toEqual({ scanned: 2, removed: 1 })
    await expect(stat(`${testUploadDirectory}/.staging/abandoned.tmp`)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(stat(`${testUploadDirectory}/.staging/in-flight.tmp`)).resolves.toBeDefined()
  })

  it('bounds each sweep by the requested entry count', async () => {
    const now = Date.UTC(2026, 7, 4, 12)
    await createArtifact('.multipart/one', now - LOCAL_UPLOAD_ARTIFACT_TTL_MS - 1)
    await createArtifact('.multipart/two', now - LOCAL_UPLOAD_ARTIFACT_TTL_MS - 1)

    const result = await sweepLocalUploadArtifacts({ now, maxEntries: 1 })

    expect(result).toEqual({ scanned: 1, removed: 1 })
  })

  it('continues from its directory cursor so old entries cannot starve behind fresh ones', async () => {
    const now = Date.UTC(2026, 7, 4, 12)
    for (let index = 0; index < 5; index++) {
      await createArtifact(`.multipart/fresh-${index}`, now)
    }
    await createArtifact('.multipart/expired-last', now - LOCAL_UPLOAD_ARTIFACT_TTL_MS - 1)

    const sweeps = [
      await sweepLocalUploadArtifacts({ now, maxEntries: 2 }),
      await sweepLocalUploadArtifacts({ now, maxEntries: 2 }),
      await sweepLocalUploadArtifacts({ now, maxEntries: 2 }),
    ]

    expect(sweeps.reduce((total, result) => total + result.scanned, 0)).toBe(6)
    expect(sweeps.reduce((total, result) => total + result.removed, 0)).toBe(1)
    await expect(stat(`${testUploadDirectory}/.multipart/expired-last`)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('coalesces concurrent cleanup and rate-limits the next sweep', async () => {
    const now = Date.UTC(2026, 7, 4, 12)
    await createArtifact('.multipart/expired', now - LOCAL_UPLOAD_ARTIFACT_TTL_MS - 1)

    const [first, concurrent] = await Promise.all([
      maybeCleanupLocalUploadArtifacts(now),
      maybeCleanupLocalUploadArtifacts(now),
    ])

    expect(first).toEqual({ scanned: 1, removed: 1 })
    expect(concurrent).toEqual(first)
    await expect(maybeCleanupLocalUploadArtifacts(now)).resolves.toEqual({ scanned: 0, removed: 0 })
  })
})

/** Staged objects are files, not the per-upload directories multipart leaves. */
async function createStagedObject(name: string, modifiedAt: number): Promise<void> {
  const directory = `${testUploadDirectory}/.staging`
  await mkdir(directory, { recursive: true })
  const path = `${directory}/${name}`
  await writeFile(path, 'test')
  const time = new Date(modifiedAt)
  await utimes(path, time, time)
}

async function createArtifact(relativePath: string, modifiedAt: number): Promise<void> {
  const path = `${testUploadDirectory}/${relativePath}`
  await mkdir(path, { recursive: true })
  await writeFile(`${path}/payload`, 'test')
  const time = new Date(modifiedAt)
  await utimes(path, time, time)
}
