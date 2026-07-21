import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import JSZip from 'jszip'
import { writeJsonAtomic } from '../fixtures/e2e-world'
import {
  assertNoSyntheticSecretLeaks,
  loadSyntheticSecretCanaryForScan,
  readSyntheticSecretCanarySecrets,
  scrubUnscannableArtifacts,
  writeSyntheticSecretCanary,
} from '../support/leak-canary'

test('credential leak canary scans artifacts but excludes its private source', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'sim-e2e-leak-canary-'))
  const secretsPath = path.join(directory, 'private', 'synthetic-secrets.json')
  const artifactsPath = path.join(directory, 'artifacts')
  const password = 'known-synthetic-password'
  try {
    writeSyntheticSecretCanary(secretsPath, 'leak-canary', [password, 'setup-only-password'])
    expect(loadSyntheticSecretCanaryForScan([], secretsPath)).toEqual([
      password,
      'setup-only-password',
    ])
    expect(loadSyntheticSecretCanaryForScan(['already-loaded'], secretsPath)).toEqual([
      'already-loaded',
      password,
      'setup-only-password',
    ])
    writeJsonAtomic(path.join(artifactsPath, 'clean.json'), { status: 'clean' })

    await expect(
      assertNoSyntheticSecretLeaks({
        secrets: readSyntheticSecretCanarySecrets(secretsPath),
        roots: [directory],
        excludedPaths: [path.dirname(secretsPath)],
      })
    ).resolves.toBeUndefined()

    const tracePath = path.join(artifactsPath, 'trace.txt')
    writeFileSync(tracePath, 'request body: setup-only-password')
    await expect(
      assertNoSyntheticSecretLeaks({
        secrets: readSyntheticSecretCanarySecrets(secretsPath),
        roots: [directory],
        excludedPaths: [path.dirname(secretsPath)],
      })
    ).rejects.toThrow(/secret leaked/)

    writeFileSync(tracePath, `request body: ${password}`)
    const zip = new JSZip()
    zip.file('trace.txt', `request body: ${password}`)
    writeFileSync(
      path.join(artifactsPath, 'trace.zip'),
      await zip.generateAsync({ type: 'nodebuffer' })
    )
    unlinkSync(tracePath)
    await expect(
      assertNoSyntheticSecretLeaks({
        secrets: readSyntheticSecretCanarySecrets(secretsPath),
        roots: [directory],
        excludedPaths: [path.dirname(secretsPath)],
      })
    ).rejects.toThrow(/secret leaked/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('malformed canaries fail closed by scrubbing unscannable diagnostics', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'sim-e2e-malformed-canary-'))
  const secretsPath = path.join(directory, 'synthetic-secrets.json')
  const diagnosticsPath = path.join(directory, 'diagnostics')
  try {
    writeFileSync(secretsPath, '{"schemaVersion":1,"secrets":["truncated')
    writeJsonAtomic(path.join(diagnosticsPath, 'report.json'), { status: 'unscanned' })
    expect(() => loadSyntheticSecretCanaryForScan(['runtime-secret'], secretsPath)).toThrow()
    scrubUnscannableArtifacts([diagnosticsPath])
    expect(existsSync(diagnosticsPath)).toBe(false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
