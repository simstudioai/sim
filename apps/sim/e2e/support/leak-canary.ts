import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { writeJsonAtomic } from '../fixtures/e2e-world'

const BINARY_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.mp4', '.png', '.webp'])

interface SyntheticSecretCanary {
  schemaVersion: 1
  runId: string
  secrets: string[]
}

export function writeSyntheticSecretCanary(
  filePath: string,
  runId: string,
  secrets: string[]
): void {
  if (secrets.length === 0 || secrets.some((secret) => !secret)) {
    throw new Error('Synthetic secret canary requires non-empty secrets')
  }
  writeJsonAtomic(filePath, {
    schemaVersion: 1,
    runId,
    secrets: [...new Set(secrets)],
  } satisfies SyntheticSecretCanary)
}

export function readSyntheticSecretCanarySecrets(filePath: string): string[] {
  return readSyntheticSecretCanary(filePath).secrets
}

export function loadSyntheticSecretCanaryForScan(
  inMemorySecrets: string[],
  filePath: string
): string[] {
  if (!existsSync(filePath)) return inMemorySecrets
  return [...new Set([...inMemorySecrets, ...readSyntheticSecretCanarySecrets(filePath)])]
}

export function scrubUnscannableArtifacts(roots: string[]): void {
  const failures: unknown[] = []
  for (const root of roots) {
    try {
      rmPath(root)
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Unable to scrub unscannable E2E artifacts')
  }
}

export async function assertNoSyntheticSecretLeaks(options: {
  secrets: string[]
  roots: string[]
  excludedPaths?: string[]
}): Promise<void> {
  if (options.secrets.length === 0 || options.secrets.some((secret) => !secret)) {
    throw new Error('Synthetic secret leak scan requires non-empty secrets')
  }
  const secrets = [...new Set(options.secrets)]
  const excluded = new Set((options.excludedPaths ?? []).map((value) => path.resolve(value)))
  const violations: string[] = []

  for (const root of options.roots) {
    if (!existsSync(root)) continue
    for (const filePath of listFiles(path.resolve(root), excluded)) {
      if (BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase())) continue
      const contents =
        path.extname(filePath).toLowerCase() === '.zip'
          ? await readZipContents(filePath)
          : readFileSync(filePath)
      if (secrets.some((secret) => contents.includes(Buffer.from(secret)))) {
        violations.push(filePath)
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `Synthetic E2E secret leaked outside private artifacts:\n${violations
        .map((filePath) => `- ${filePath}`)
        .join('\n')}`
    )
  }
}

function readSyntheticSecretCanary(filePath: string): SyntheticSecretCanary {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<SyntheticSecretCanary>
  if (
    parsed.schemaVersion !== 1 ||
    typeof parsed.runId !== 'string' ||
    !Array.isArray(parsed.secrets) ||
    parsed.secrets.length === 0 ||
    parsed.secrets.some((secret) => typeof secret !== 'string' || !secret)
  ) {
    throw new Error('Invalid synthetic secret canary artifact')
  }
  return parsed as SyntheticSecretCanary
}

function listFiles(currentPath: string, excluded: ReadonlySet<string> = new Set()): string[] {
  if (excluded.has(currentPath)) return []
  const stats = lstatSync(currentPath)
  if (stats.isSymbolicLink()) return []
  if (stats.isFile()) return [currentPath]
  if (!stats.isDirectory()) return []
  return readdirSync(currentPath).flatMap((name) =>
    listFiles(path.join(currentPath, name), excluded)
  )
}

function rmPath(filePath: string): void {
  rmSync(filePath, { recursive: true, force: true })
  if (existsSync(filePath)) throw new Error(`Unscannable E2E artifact still exists: ${filePath}`)
}

async function readZipContents(filePath: string): Promise<Buffer> {
  try {
    const archive = await JSZip.loadAsync(readFileSync(filePath))
    const contents = await Promise.all(
      Object.values(archive.files)
        .filter((entry) => !entry.dir)
        .map(async (entry) => Buffer.from(await entry.async('uint8array')))
    )
    return Buffer.concat(contents)
  } catch {
    throw new Error(`Unable to inspect E2E diagnostic archive: ${filePath}`)
  }
}
