import { isPlainRecord } from '@sim/utils/object'

const PROTOCOL_PATTERN = /^https?:\/\//i

/** Error thrown when a Jupyter server URL cannot be normalized to an HTTP(S) origin. */
export class InvalidJupyterServerUrlError extends Error {
  constructor(rawUrl: string) {
    super(`Invalid Jupyter server URL: ${rawUrl}`)
    this.name = 'InvalidJupyterServerUrlError'
  }
}

/** Normalizes a user-supplied Jupyter server URL without changing its base path. */
export function normalizeJupyterServerUrl(rawUrl: unknown): string {
  const raw = typeof rawUrl === 'string' ? rawUrl.trim() : ''
  if (!raw) throw new InvalidJupyterServerUrlError(String(rawUrl))

  const withProtocol = PROTOCOL_PATTERN.test(raw) ? raw : `http://${raw}`

  let parsed: URL
  try {
    parsed = new URL(withProtocol)
  } catch {
    throw new InvalidJupyterServerUrlError(raw)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidJupyterServerUrlError(raw)
  }

  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
}

/** Builds the token authorization header expected by Jupyter Server. */
export function buildJupyterAuthHeaders(token: string): Record<string, string> {
  return { Authorization: `token ${token}` }
}

/** Error thrown when a Jupyter path contains a traversal segment. */
export class UnsafeJupyterPathError extends Error {
  constructor(rawPath: string) {
    super(`Invalid Jupyter path: ${rawPath}`)
    this.name = 'UnsafeJupyterPathError'
  }
}

function assertNoJupyterPathTraversal(path: string | undefined): string[] {
  const raw = path ?? ''

  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    decoded = raw
  }

  if (decoded.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new UnsafeJupyterPathError(raw)
  }

  return raw.split('/').filter((segment) => segment.length > 0)
}

/** Encodes a Jupyter contents path segment-by-segment while preserving separators. */
export function encodeJupyterPath(path: string | undefined): string {
  return assertNoJupyterPathTraversal(path).map(encodeURIComponent).join('/')
}

/** Validates a Jupyter contents path that will be sent in a JSON body. */
export function assertSafeJupyterPath(path: string): string {
  assertNoJupyterPathTraversal(path)
  return path
}

/** Validates an encoded relative path beneath Jupyter's `/api/` prefix. */
export function assertSafeJupyterProxyPath(rawPath: string): void {
  const [pathname] = rawPath.split('?')
  assertNoJupyterPathTraversal(pathname)
}

export interface JupyterContentModel {
  name?: string
  path?: string
  type?: 'directory' | 'file' | 'notebook'
  writable?: boolean
  created?: string
  lastModified?: string
  size?: number
  mimetype?: string
  format?: 'json' | 'text' | 'base64'
  content?: unknown
}

/** Parses the shared model returned by Jupyter's Contents API. */
export function parseJupyterContentModel(value: unknown): JupyterContentModel | null {
  if (!isPlainRecord(value)) return null

  const type =
    value.type === 'directory' || value.type === 'file' || value.type === 'notebook'
      ? value.type
      : undefined
  const format =
    value.format === 'json' || value.format === 'text' || value.format === 'base64'
      ? value.format
      : undefined

  return {
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.path === 'string' ? { path: value.path } : {}),
    ...(type ? { type } : {}),
    ...(typeof value.writable === 'boolean' ? { writable: value.writable } : {}),
    ...(typeof value.created === 'string' ? { created: value.created } : {}),
    ...(typeof value.last_modified === 'string' ? { lastModified: value.last_modified } : {}),
    ...(typeof value.size === 'number' ? { size: value.size } : {}),
    ...(typeof value.mimetype === 'string' ? { mimetype: value.mimetype } : {}),
    ...(format ? { format } : {}),
    ...('content' in value ? { content: value.content } : {}),
  }
}

interface RawJupyterKernel {
  id?: string
  name?: string
  last_activity?: string
  execution_state?: string
  connections?: number
}

/** Maps a raw Jupyter kernel model to Sim's tool output shape. */
export function mapJupyterKernel(raw: RawJupyterKernel): {
  id: string
  name: string
  lastActivity: string | null
  executionState: string | null
  connections: number | null
} {
  return {
    id: raw.id ?? '',
    name: raw.name ?? '',
    lastActivity: raw.last_activity ?? null,
    executionState: raw.execution_state ?? null,
    connections: raw.connections ?? null,
  }
}

interface RawJupyterSession {
  id?: string
  path?: string
  name?: string
  type?: string
  kernel?: RawJupyterKernel | null
}

/** Maps a raw Jupyter session model to Sim's tool output shape. */
export function mapJupyterSession(raw: RawJupyterSession): {
  id: string
  path: string
  name: string
  type: string
  kernel: ReturnType<typeof mapJupyterKernel> | null
} {
  return {
    id: raw.id ?? '',
    path: raw.path ?? '',
    name: raw.name ?? '',
    type: raw.type ?? '',
    kernel: raw.kernel ? mapJupyterKernel(raw.kernel) : null,
  }
}
