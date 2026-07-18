import { createHash } from 'node:crypto'
import { stableStringify } from '@/lib/apps/manifest'

export const ARTIFACT_MANIFEST_VERSION = 1 as const
export const REAL_ARTIFACT_HASH_PREFIX = 'sha256:'
export const REAL_ARTIFACT_HASH_RE = /^sha256:[0-9a-f]{64}$/

export type ArtifactManifestFile = {
  path: string
  hash: string
  byteSize: number
  contentType: string
}

export type ArtifactManifest = {
  version: typeof ARTIFACT_MANIFEST_VERSION
  entrypoint: string
  files: ArtifactManifestFile[]
}

const ALLOWED_OUTPUT_EXT = new Set([
  '.html',
  '.js',
  '.css',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.woff',
  '.woff2',
  '.json',
  '.ico',
])

/** Output budget (separate from source caps). */
export const ARTIFACT_MAX_FILES = 500
export const ARTIFACT_MAX_FILE_BYTES = 5_000_000
export const ARTIFACT_MAX_TOTAL_BYTES = 20_000_000

export function isRealArtifactHash(hash: string): boolean {
  return REAL_ARTIFACT_HASH_RE.test(hash)
}

export function stripArtifactHashPrefix(hash: string): string {
  if (hash.startsWith(REAL_ARTIFACT_HASH_PREFIX))
    return hash.slice(REAL_ARTIFACT_HASH_PREFIX.length)
  if (hash.startsWith('fixture:')) return hash.slice('fixture:'.length)
  return hash
}

export function contentTypeForPath(path: string): string {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8'
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (path.endsWith('.css')) return 'text/css; charset=utf-8'
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  if (path.endsWith('.webp')) return 'image/webp'
  if (path.endsWith('.woff2')) return 'font/woff2'
  if (path.endsWith('.woff')) return 'font/woff'
  if (path.endsWith('.ico')) return 'image/x-icon'
  return 'application/octet-stream'
}

function extOf(path: string): string {
  const i = path.lastIndexOf('.')
  return i >= 0 ? path.slice(i).toLowerCase() : ''
}

export function assertSafeArtifactPath(path: string): string | null {
  if (!path || path.includes('\\') || path.includes('\0')) return 'Illegal path'
  if (path.startsWith('/') || path.includes('..')) return 'Path traversal rejected'
  if (path.split('/').some((p) => p === '' || p === '.' || p === '..'))
    return 'Illegal path segment'
  const ext = extOf(path)
  if (!ext || !ALLOWED_OUTPUT_EXT.has(ext)) return `Disallowed output extension: ${path}`
  return null
}

export function hashArtifactManifest(manifest: ArtifactManifest): string {
  const digest = createHash('sha256').update(stableStringify(manifest)).digest('hex')
  return `${REAL_ARTIFACT_HASH_PREFIX}${digest}`
}

export function canonicalManifestBytes(manifest: ArtifactManifest): string {
  return `${stableStringify(manifest)}\n`
}

/**
 * Build a canonical manifest from trusted file bytes (worker-inspected, not sandbox-claimed).
 * Source maps are skipped (not fail-closed) when sourcemaps leak into dist/.
 */
export function buildArtifactManifest(
  files: Array<{ path: string; content: Buffer }>
): { ok: true; manifest: ArtifactManifest; manifestHash: string } | { ok: false; error: string } {
  const filtered = files.filter((f) => !f.path.endsWith('.map'))
  if (filtered.length === 0) return { ok: false, error: 'Build produced no output files' }
  if (filtered.length > ARTIFACT_MAX_FILES) {
    return { ok: false, error: `Too many output files (max ${ARTIFACT_MAX_FILES})` }
  }

  const seen = new Set<string>()
  let total = 0
  const entries: ArtifactManifestFile[] = []

  for (const file of filtered) {
    const pathError = assertSafeArtifactPath(file.path)
    if (pathError) return { ok: false, error: pathError }
    if (seen.has(file.path)) return { ok: false, error: `Duplicate output path: ${file.path}` }
    seen.add(file.path)

    if (file.content.byteLength > ARTIFACT_MAX_FILE_BYTES) {
      return { ok: false, error: `Output file too large: ${file.path}` }
    }
    total += file.content.byteLength
    if (total > ARTIFACT_MAX_TOTAL_BYTES) {
      return { ok: false, error: 'Build output exceeds size cap' }
    }

    entries.push({
      path: file.path,
      hash: createHash('sha256').update(file.content).digest('hex'),
      byteSize: file.content.byteLength,
      contentType: contentTypeForPath(file.path),
    })
  }

  entries.sort((a, b) => a.path.localeCompare(b.path))

  if (!entries.some((e) => e.path === 'index.html')) {
    return { ok: false, error: 'Build output missing index.html' }
  }

  const manifest: ArtifactManifest = {
    version: ARTIFACT_MANIFEST_VERSION,
    entrypoint: 'index.html',
    files: entries,
  }

  return { ok: true, manifest, manifestHash: hashArtifactManifest(manifest) }
}

export function parseArtifactManifest(raw: unknown): ArtifactManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as ArtifactManifest
  if (m.version !== ARTIFACT_MANIFEST_VERSION) return null
  if (m.entrypoint !== 'index.html') return null
  if (!Array.isArray(m.files) || m.files.length === 0) return null
  for (const f of m.files) {
    if (!f || typeof f.path !== 'string' || typeof f.hash !== 'string') return null
    if (!/^[0-9a-f]{64}$/.test(f.hash)) return null
    if (typeof f.byteSize !== 'number' || typeof f.contentType !== 'string') return null
    if (assertSafeArtifactPath(f.path)) return null
  }
  return {
    version: ARTIFACT_MANIFEST_VERSION,
    entrypoint: 'index.html',
    files: [...m.files].sort((a, b) => a.path.localeCompare(b.path)),
  }
}

/** Parse + verify digest matches expected sha256:… hash. */
export function parseAndVerifyArtifactManifest(
  raw: unknown,
  expectedManifestHash: string
): ArtifactManifest | null {
  if (!isRealArtifactHash(expectedManifestHash)) return null
  const manifest = parseArtifactManifest(raw)
  if (!manifest) return null
  if (hashArtifactManifest(manifest) !== expectedManifestHash) return null
  return manifest
}
