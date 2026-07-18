import { createHmac, timingSafeEqual } from 'node:crypto'
import { getEnv } from '@/lib/core/config/env'
import { isProd } from '@/lib/core/config/env-flags'

/** Short-lived Apps file capability TTL. */
const FILE_CAPABILITY_TTL_MS = 15 * 60 * 1000

export type AppsFileCapabilityClaims = {
  workspaceId: string
  workflowId: string
  executionId: string
  fileKey: string
  name: string
  mimeType: string
  size: number
  /** Optional published release context. */
  releaseId?: string
  /** Optional preview session context. */
  previewSessionId?: string
  projectId?: string
  exp: number
}

export type AppsPublicFile = {
  url: string
  name: string
  mimeType: string
  size: number
}

function fileCapabilitySecret(): string {
  const dedicated = (getEnv('APPS_FILE_CAPABILITY_SECRET') || '').trim()
  if (dedicated.length >= 32) return dedicated
  if (isProd) {
    throw new Error('APPS_FILE_CAPABILITY_SECRET must be configured in production')
  }
  const hop = (getEnv('APPS_PROXY_HOP_SECRET') || '').trim()
  if (hop.length >= 32) return hop
  throw new Error('APPS_FILE_CAPABILITY_SECRET (preferred) or APPS_PROXY_HOP_SECRET must be set')
}

export function issueAppsFileCapability(
  claims: Omit<AppsFileCapabilityClaims, 'exp'>,
  now = Date.now()
): string {
  const payload: AppsFileCapabilityClaims = {
    ...claims,
    exp: now + FILE_CAPABILITY_TTL_MS,
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', fileCapabilitySecret()).update(body, 'utf8').digest('base64url')
  return `${body}.${sig}`
}

export function verifyAppsFileCapability(
  token: string | null | undefined,
  now = Date.now()
): { ok: true; claims: AppsFileCapabilityClaims } | { ok: false; reason: string } {
  if (!token) return { ok: false, reason: 'missing' }
  const [body, sig] = token.split('.')
  if (!body || !sig) return { ok: false, reason: 'malformed' }

  const expected = createHmac('sha256', fileCapabilitySecret()).update(body, 'utf8').digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' }
  }

  try {
    const claims = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8')
    ) as AppsFileCapabilityClaims
    if (
      !claims.workspaceId ||
      !claims.workflowId ||
      !claims.executionId ||
      !claims.fileKey ||
      !claims.name ||
      typeof claims.mimeType !== 'string' ||
      typeof claims.size !== 'number' ||
      typeof claims.exp !== 'number'
    ) {
      return { ok: false, reason: 'invalid_claims' }
    }
    if (claims.exp < now) return { ok: false, reason: 'expired' }
    return { ok: true, claims }
  } catch {
    return { ok: false, reason: 'invalid_claims' }
  }
}

export function appsFileProxyPath(token: string): string {
  return `/__sim/files/${encodeURIComponent(token)}`
}

export function toAppsPublicFile(
  claims: Omit<AppsFileCapabilityClaims, 'exp'>,
  now = Date.now()
): AppsPublicFile {
  const token = issueAppsFileCapability(claims, now)
  return {
    url: appsFileProxyPath(token),
    name: claims.name,
    mimeType: claims.mimeType,
    size: claims.size,
  }
}

/**
 * Lightweight content sniffing for common image types. Returns null when unknown.
 */
export function sniffContentType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png'
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (buffer.length >= 6) {
    const header = buffer.toString('ascii', 0, 6)
    if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif'
  }
  if (buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-') {
    return 'application/pdf'
  }
  return null
}

/**
 * Accept claimed MIME when it matches sniffed type, or when sniffing is inconclusive
 * for non-image payloads. Reject clear mismatches for sniffed image types.
 */
export function resolveSafeContentType(claimed: string, buffer: Buffer): string | null {
  const sniffed = sniffContentType(buffer)
  const normalizedClaimed = (claimed || 'application/octet-stream').toLowerCase().split(';')[0]!.trim()

  if (!sniffed) {
    return normalizedClaimed || 'application/octet-stream'
  }

  if (normalizedClaimed === sniffed) return sniffed
  // Allow jpeg/jpg aliasing
  if (
    (normalizedClaimed === 'image/jpg' || normalizedClaimed === 'image/jpeg') &&
    sniffed === 'image/jpeg'
  ) {
    return 'image/jpeg'
  }
  // Claimed type disagrees with bytes — prefer sniffed for known media, but
  // reject when the claim was a different image family.
  if (normalizedClaimed.startsWith('image/') && sniffed.startsWith('image/')) {
    return null
  }
  return sniffed
}

export function parseExecutionFileKey(
  key: string
): { workspaceId: string; workflowId: string; executionId: string } | null {
  const parts = key.split('/')
  if (parts[0] !== 'execution' || parts.length < 5) return null
  const workspaceId = parts[1]
  const workflowId = parts[2]
  const executionId = parts[3]
  if (!workspaceId || !workflowId || !executionId) return null
  return { workspaceId, workflowId, executionId }
}
