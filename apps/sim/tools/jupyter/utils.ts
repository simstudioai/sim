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
 * Error thrown when a user-supplied Jupyter contents path contains a `.` or
 * `..` segment that could traverse outside the intended directory.
 */
export class UnsafeJupyterPathError extends Error {
  constructor(rawPath: string) {
    super(`Invalid Jupyter path: ${rawPath}`)
    this.name = 'UnsafeJupyterPathError'
  }
}

/**
 * Rejects `.` and `..` segments in a Jupyter contents path, which could
 * otherwise traverse outside the intended directory on the target server.
 * Shared by every helper that sends a path to Jupyter, whether in a URL or a
 * request body.
 *
 * @throws {UnsafeJupyterPathError} when a segment is `.` or `..`.
 */
function assertNoJupyterPathTraversal(path: string | undefined): string[] {
  const segments = (path ?? '').split('/').filter((segment) => segment.length > 0)

  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new UnsafeJupyterPathError(path ?? '')
    }
  }

  return segments
}

/**
 * Encodes a Jupyter contents path segment-by-segment so slashes stay as path
 * separators while special characters within a segment are escaped. Use for
 * paths interpolated into a request URL.
 *
 * @throws {UnsafeJupyterPathError} when a segment is `.` or `..`.
 */
export function encodeJupyterPath(path: string | undefined): string {
  return assertNoJupyterPathTraversal(path).map(encodeURIComponent).join('/')
}

/**
 * Validates a Jupyter contents path with no URL-encoding. Use for paths sent
 * as-is in a JSON request body (e.g. a PATCH/POST `path`/`copy_from` field)
 * that never flow through `encodeJupyterPath`.
 *
 * @throws {UnsafeJupyterPathError} when a segment is `.` or `..`.
 */
export function assertSafeJupyterPath(path: string): string {
  assertNoJupyterPathTraversal(path)
  return path
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
