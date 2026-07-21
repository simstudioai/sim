import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import {
  type BuildArtifactPaths,
  type BuildIdentity,
  clearActiveNextBuild,
  pruneBuildCache,
  restoreCachedBuild,
  storeCompletedBuild,
} from '../support/build-manifest'
import { acquireE2eRunLock } from '../support/run-lock'

const identity: BuildIdentity = {
  schemaVersion: 1,
  nextBuildHash: 'next-build-hash',
  sourceHash: 'source-hash',
  profileHash: 'profile-hash',
  nodeVersion: 'v22.0.0',
  bunVersion: '1.0.0',
  nextVersion: '16.0.0',
  platform: process.platform,
  architecture: process.arch,
}

test.describe('verified Next build cache', () => {
  test('stores, restores, and rejects artifact corruption', () => {
    withBuildPaths((paths) => {
      writeBuild(paths.activeNextDirectory, 'build-one', 'original')
      storeCompletedBuild(identity, paths)
      clearActiveNextBuild(paths.activeNextDirectory)
      const staleRestore = `${paths.activeNextDirectory}.e2e-restore-123`
      const staleBackup = `${paths.activeNextDirectory}.e2e-backup-123`
      const interruptedStore = path.join(paths.buildCacheDirectory, 'other-hash.tmp-123')
      mkdirSync(staleRestore)
      mkdirSync(staleBackup)
      mkdirSync(interruptedStore)

      expect(restoreCachedBuild(identity, paths)).toMatchObject({
        reused: true,
        reason: 'verified cache hit',
      })
      expect(readFileSync(path.join(paths.activeNextDirectory, 'server.js'), 'utf8')).toBe(
        'original'
      )
      expect(existsSync(staleRestore)).toBe(false)
      expect(existsSync(staleBackup)).toBe(false)
      expect(existsSync(interruptedStore)).toBe(false)

      writeFileSync(
        path.join(paths.buildCacheDirectory, identity.nextBuildHash, '.next', 'server.js'),
        'tampered'
      )
      expect(restoreCachedBuild(identity, paths)).toMatchObject({
        reused: false,
        reason: 'cached artifact checksum does not match the manifest',
      })
    })
  })

  test('rejects manifest identity and BUILD_ID corruption', () => {
    withBuildPaths((paths) => {
      writeBuild(paths.activeNextDirectory, 'build-one', 'original')
      storeCompletedBuild(identity, paths)
      const cacheDirectory = path.join(paths.buildCacheDirectory, identity.nextBuildHash)
      const manifestPath = path.join(cacheDirectory, 'manifest.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, sourceHash: 'wrong' }))
      expect(restoreCachedBuild(identity, paths).reason).toBe(
        'cache manifest identity does not match'
      )

      writeFileSync(manifestPath, JSON.stringify(manifest))
      writeFileSync(path.join(cacheDirectory, '.next', 'BUILD_ID'), 'wrong')
      expect(restoreCachedBuild(identity, paths).reason).toBe(
        'cached BUILD_ID does not match the manifest'
      )
    })
  })

  test('prunes old build entries while retaining the selected cache', () => {
    withBuildPaths((paths) => {
      const now = Date.now() / 1_000
      for (const [index, name] of ['oldest', 'newer', identity.nextBuildHash].entries()) {
        const directory = path.join(paths.buildCacheDirectory, name)
        mkdirSync(directory, { recursive: true })
        utimesSync(directory, now + index, now + index)
      }
      const abandonedStore = path.join(paths.buildCacheDirectory, 'abandoned.tmp-123')
      mkdirSync(abandonedStore)
      expect(pruneBuildCache(identity.nextBuildHash, 2, paths.buildCacheDirectory)).toEqual([
        'oldest',
      ])
      expect(existsSync(abandonedStore)).toBe(false)
      expect(restoreCachedBuild(identity, paths).reason).toBe(
        'cache artifact or completed manifest is missing'
      )
    })
  })
})

test('orchestrator lock rejects live ownership and recovers stale descriptors', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'sim-e2e-run-lock-'))
  const lockPath = path.join(directory, 'orchestrator.lock')
  try {
    const lock = acquireE2eRunLock(lockPath)
    expect(() => acquireE2eRunLock(lockPath)).toThrow(/Another E2E orchestrator/)
    lock.transfer(process.pid)
    expect(() => acquireE2eRunLock(lockPath)).toThrow(/Another E2E orchestrator/)
    lock.retain('manual cleanup required')
    lock.transfer(process.pid)
    expect(() => acquireE2eRunLock(lockPath)).toThrow(/manual cleanup required/)
    lock.release()

    mkdirSync(lockPath)
    expect(() => acquireE2eRunLock(lockPath)).toThrow(/is acquiring/)
    rmSync(lockPath, { recursive: true })

    mkdirSync(lockPath)
    writeFileSync(
      path.join(lockPath, 'owner.json'),
      JSON.stringify({
        pid: 2_147_483_647,
        token: 'stale',
        startedAt: '2000-01-01T00:00:00Z',
        processStartIdentity: null,
      })
    )
    const recovered = acquireE2eRunLock(lockPath)
    recovered.release()

    mkdirSync(lockPath)
    writeFileSync(
      path.join(lockPath, 'owner.json'),
      JSON.stringify({
        pid: process.pid,
        token: 'reused-pid',
        startedAt: '2000-01-01T00:00:00Z',
        processStartIdentity: 'not-the-current-process-start',
      })
    )
    const reusedPidRecovered = acquireE2eRunLock(lockPath)
    reusedPidRecovered.release()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

function withBuildPaths(run: (paths: BuildArtifactPaths) => void): void {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'sim-e2e-build-cache-'))
  try {
    run({
      activeNextDirectory: path.join(directory, '.next'),
      buildCacheDirectory: path.join(directory, 'cache'),
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function writeBuild(directory: string, buildId: string, contents: string): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, 'BUILD_ID'), buildId)
  writeFileSync(path.join(directory, 'server.js'), contents)
}
