const PROTOCOL_PATTERN = /^https?:\/\//i

/**
 * Error thrown when a user-supplied Jupyter server URL cannot be parsed into a
 * safe http(s) origin to target with the caller's token.
 */
export class InvalidJupyterServerUrlError extends Error {
  constructor(rawUrl: string) {
    super(`Invalid Jupyter server URL: ${rawUrl}`)
    this.name = 'InvalidJupyterServerUrlError'
  }
}

/**
 * Normalizes a user-supplied Jupyter server URL: trims whitespace, defaults to
 * `http://` when no scheme is given (most Jupyter servers run over plain HTTP
 * on localhost or a private network), and strips any trailing slash and
 * query/fragment. Self-hosted Jupyter servers have no fixed public host, so the
 * URL is always user-supplied.
 *
 * @throws {InvalidJupyterServerUrlError} when the value is empty or not a valid http(s) URL.
 */
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

/**
 * Builds the `Authorization` header Jupyter Server expects for token auth.
 */
export function buildJupyterAuthHeaders(token: string): Record<string, string> {
  return { Authorization: `token ${token}` }
}

/**
 * Encodes a Jupyter contents path segment-by-segment so slashes stay as path
 * separators while special characters within a segment are escaped.
 */
export function encodeJupyterPath(path: string | undefined): string {
  return (path ?? '')
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join('/')
}

interface RawJupyterKernel {
  id?: string
  name?: string
  last_activity?: string
  execution_state?: string
  connections?: number
}

/**
 * Maps a raw Jupyter kernel model (from Kernels/Sessions API responses) to
 * Sim's shaped `JupyterKernel` output.
 */
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

/**
 * Maps a raw Jupyter session model to Sim's shaped `JupyterSession` output.
 */
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
