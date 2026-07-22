import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
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

test('credential patterns are bounded and ZIP entries are scanned independently', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'sim-e2e-credential-patterns-'))
  const token = Array.from({ length: 32 }, (_, index) =>
    String.fromCharCode('A'.charCodeAt(0) + (index % 26))
  ).join('')
  const encryptedKey = `${['sk', 'sim'].join('-')}-${token}`
  const legacyKey = `${['sim', ''].join('_')}${token}`
  const runtimeSecret = `${['E2E', 'RUNTIME', 'SECRET', 'V1'].join('_')}_${token}`
  const scan = () =>
    assertNoSyntheticSecretLeaks({
      secrets: ['exact-canary-not-present'],
      roots: [directory],
    })

  try {
    const positivePath = path.join(directory, 'report.html')
    writeFileSync(positivePath, `response: ${encryptedKey}`)
    await expect(scan()).rejects.toThrow(/artifact-1-1/)
    expect(await scan().catch((error: Error) => error.message)).not.toContain(positivePath)
    unlinkSync(positivePath)

    const positiveZip = new JSZip()
    positiveZip.file('network.txt', `response: ${legacyKey}`)
    positiveZip.file(`entry-${runtimeSecret}.txt`, 'entry names are scanned too')
    const zipPath = path.join(directory, 'trace.zip')
    writeFileSync(zipPath, await positiveZip.generateAsync({ type: 'nodebuffer' }))
    await expect(scan()).rejects.toThrow(/secret leaked/)
    unlinkSync(zipPath)

    const directoryNameZip = new JSZip()
    directoryNameZip.folder(runtimeSecret)
    writeFileSync(zipPath, await directoryNameZip.generateAsync({ type: 'nodebuffer' }))
    await expect(scan()).rejects.toThrow(/runtime-secret/)
    unlinkSync(zipPath)

    const directoryPath = path.join(directory, runtimeSecret)
    mkdirSync(directoryPath)
    await expect(scan()).rejects.toThrow(/runtime-secret/)
    rmSync(directoryPath, { recursive: true })

    const binaryPath = path.join(directory, `${encryptedKey}.png`)
    writeFileSync(binaryPath, Buffer.alloc(0))
    await expect(scan()).rejects.toThrow(/current-api-key/)
    unlinkSync(binaryPath)

    const outerZipPath = path.join(directory, `${legacyKey}.zip`)
    const cleanZip = new JSZip()
    cleanZip.file('clean.txt', 'clean')
    writeFileSync(outerZipPath, await cleanZip.generateAsync({ type: 'nodebuffer' }))
    await expect(scan()).rejects.toThrow(/legacy-api-key/)
    unlinkSync(outerZipPath)

    writeFileSync(
      path.join(directory, 'clean.txt'),
      [
        'sk-sim-••••••••',
        'sk-sim-prefix-only',
        `sk-sim-${token.slice(0, 31)}`,
        `sk-sim-${token}A`,
        `sim_e2e_${token}`,
        `E2E_RUNTIME_SECRET_V1_${token.slice(0, 31)}`,
      ].join('\n')
    )
    const splitZip = new JSZip()
    splitZip.file('first.txt', `sk-sim-${token.slice(0, 16)}`)
    splitZip.file('second.txt', token.slice(16))
    writeFileSync(
      path.join(directory, 'split.zip'),
      await splitZip.generateAsync({ type: 'nodebuffer' })
    )
    await expect(scan()).resolves.toBeUndefined()
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
