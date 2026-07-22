import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { writeJsonAtomic } from '../fixtures/e2e-world'

const BINARY_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.mp4', '.png', '.webp'])
const BASE64URL_TOKEN = '[A-Za-z0-9_-]{32}'
// Keep these patterns aligned with lib/testing/credential-diagnostic-redaction.ts.
const FORBIDDEN_CREDENTIAL_PATTERNS = [
  {
    kind: 'current-api-key',
    pattern: new RegExp(`sk-sim-${BASE64URL_TOKEN}(?![A-Za-z0-9_-])`),
  },
  {
    kind: 'legacy-api-key',
    pattern: new RegExp(`sim_(?!e2e_)${BASE64URL_TOKEN}(?![A-Za-z0-9_-])`),
  },
  {
    kind: 'runtime-secret',
    pattern: new RegExp(`E2E_RUNTIME_SECRET_V1_${BASE64URL_TOKEN}(?![A-Za-z0-9_-])`),
  },
] as const

interface ArtifactEntry {
  path: string
  kind: 'directory' | 'file' | 'other'
}

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

  for (const [rootIndex, root] of options.roots.entries()) {
    if (!existsSync(root)) continue
    const resolvedRoot = path.resolve(root)
    for (const [entryIndex, entry] of listArtifactEntries(resolvedRoot, excluded).entries()) {
      const relativeName = path.relative(resolvedRoot, entry.path) || path.basename(entry.path)
      const records: Buffer[] = [Buffer.from(relativeName)]
      if (entry.kind === 'file' && !BINARY_EXTENSIONS.has(path.extname(entry.path).toLowerCase())) {
        records.push(
          ...(path.extname(entry.path).toLowerCase() === '.zip'
            ? await readZipRecords(entry.path)
            : [readFileSync(entry.path)])
        )
      }
      const leakKind = records
        .map((contents) => credentialLeakKind(contents, secrets))
        .find((kind): kind is string => Boolean(kind))
      if (leakKind) {
        violations.push(`artifact-${rootIndex + 1}-${entryIndex + 1}:${leakKind}`)
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `Synthetic E2E secret leaked outside private artifacts:\n${violations
        .map((identifier) => `- ${identifier}`)
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

function listArtifactEntries(
  currentPath: string,
  excluded: ReadonlySet<string> = new Set(),
  includeCurrent = false
): ArtifactEntry[] {
  if (excluded.has(currentPath)) return []
  const stats = lstatSync(currentPath)
  const kind = stats.isFile() ? 'file' : stats.isDirectory() ? 'directory' : 'other'
  const current = includeCurrent ? [{ path: currentPath, kind } satisfies ArtifactEntry] : []
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    return includeCurrent ? current : [{ path: currentPath, kind }]
  }
  return [
    ...current,
    ...readdirSync(currentPath).flatMap((name) =>
      listArtifactEntries(path.join(currentPath, name), excluded, true)
    ),
  ]
}

function rmPath(filePath: string): void {
  rmSync(filePath, { recursive: true, force: true })
  if (existsSync(filePath)) throw new Error(`Unscannable E2E artifact still exists: ${filePath}`)
}

function credentialLeakKind(contents: Buffer, secrets: string[]): string | null {
  if (secrets.some((secret) => contents.includes(Buffer.from(secret)))) return 'exact-canary'
  const text = contents.toString('utf8')
  return FORBIDDEN_CREDENTIAL_PATTERNS.find(({ pattern }) => pattern.test(text))?.kind ?? null
}

async function readZipRecords(filePath: string): Promise<Buffer[]> {
  try {
    const archive = await JSZip.loadAsync(readFileSync(filePath))
    const entries = Object.values(archive.files)
    const contents = await Promise.all(
      entries
        .filter((entry) => !entry.dir)
        .map(async (entry) => Buffer.from(await entry.async('uint8array')))
    )
    return [...entries.map((entry) => Buffer.from(entry.name)), ...contents]
  } catch {
    throw new Error('Unable to inspect an E2E diagnostic archive')
  }
}
