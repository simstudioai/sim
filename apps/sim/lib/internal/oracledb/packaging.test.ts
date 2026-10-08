/**
 * @vitest-environment node
 */
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { copyMatcherResults, findFilesByMatchers } from '@trigger.dev/build/internal'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const APP_DIR = path.resolve(__dirname, '../../..')
const DRIVER_DIR = path.resolve(APP_DIR, '../../node_modules/oracledb')
const TRIGGER_MATCHERS = [
  './lib/internal/oracledb/oracle-worker.cjs',
  './scripts/oracledb-patch-self-test.cjs',
  './scripts/verify-oracledb-patch.cjs',
  '../../node_modules/oracledb/**/*',
] as const

let artifactDir = ''

async function listFiles(root: string, relativeDir = ''): Promise<string[]> {
  const entries = await readdir(path.join(root, relativeDir), { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(root, relativePath)))
    else if (entry.isFile()) files.push(relativePath)
  }
  return files.sort()
}

async function sha256(file: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
}

describe('Oracle Database deployment packaging', () => {
  beforeAll(async () => {
    artifactDir = await mkdtemp(path.join(tmpdir(), 'sim-oracledb-trigger-'))
  })

  afterAll(async () => {
    if (artifactDir) await rm(artifactDir, { recursive: true, force: true })
  })

  it('copies a complete, byte-identical driver and worker through Trigger additionalFiles', async () => {
    const triggerConfig = await readFile(path.join(APP_DIR, 'trigger.config.ts'), 'utf8')
    for (const matcher of TRIGGER_MATCHERS) expect(triggerConfig).toContain(`'${matcher}'`)

    const matches = await findFilesByMatchers([...TRIGGER_MATCHERS], artifactDir, {
      cwd: APP_DIR,
    })
    expect(matches.every(({ assets }) => assets.length > 0)).toBe(true)
    await copyMatcherResults(matches)

    const sourceFiles = (await listFiles(DRIVER_DIR)).filter(
      (relativePath) => !path.basename(relativePath).startsWith('.bun-tag-')
    )
    const artifactDriverDir = path.join(artifactDir, 'node_modules/oracledb')
    expect(await listFiles(artifactDriverDir)).toEqual(sourceFiles)
    for (const relativePath of sourceFiles) {
      expect(await sha256(path.join(artifactDriverDir, relativePath))).toBe(
        await sha256(path.join(DRIVER_DIR, relativePath))
      )
    }

    await expect(
      readFile(path.join(artifactDir, 'lib/internal/oracledb/oracle-worker.cjs'), 'utf8')
    ).resolves.toContain('verifyOracleDbPatch')
    await expect(
      readFile(path.join(artifactDir, 'scripts/verify-oracledb-patch.cjs'), 'utf8')
    ).resolves.toContain('EXPECTED_SOURCE_HASHES')
    await expect(
      readFile(path.join(artifactDir, 'scripts/oracledb-patch-self-test.cjs'), 'utf8')
    ).resolves.toContain('testProxyPrecedence')
  })
})
