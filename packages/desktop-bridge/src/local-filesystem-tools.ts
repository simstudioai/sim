/**
 * The model's `read`, `grep` and `glob` over user-local folders, run against the desktop's
 * local filesystem service. The chat view runs them through the preload bridge; the desktop's
 * background executor runs them in-process. Both get the same paths and result shapes.
 */
import micromatch from 'micromatch'
import type {
  LocalFilesystemData,
  LocalFilesystemMount,
  LocalFilesystemRequest,
  LocalFilesystemResponse,
} from './index'
import {
  DEFAULT_GREP_CONTEXT,
  DEFAULT_GREP_RESULTS,
  DEFAULT_READ_LINES,
  MAX_GREP_CONTEXT,
  MAX_GREP_RESULTS,
  MAX_READ_LINES,
} from './local-filesystem-limits'

/** The VFS directory every granted folder is mounted under. */
const USER_LOCAL_VFS_ROOT = 'user-local'

/**
 * This glob runs against already-listed mounts, so unlike the grep and read limits it is nobody
 * else's business: the shell never authorizes against it.
 */
const MAX_USER_LOCAL_GLOB_RESULTS = 500

const VFS_GLOB_OPTIONS: micromatch.Options = {
  bash: false,
  dot: false,
  windows: false,
  nobrace: true,
  noext: true,
}

export interface UserLocalFilesystemToolContext {
  /** Sends one request to the local filesystem service. */
  invoke: (request: LocalFilesystemRequest) => Promise<LocalFilesystemResponse>
  /** The `user-local/<name>--<id>` directory a mount appears under. */
  vfsRoot: (mount: LocalFilesystemMount) => string
  signal?: AbortSignal
}

function requiredString(args: Record<string, unknown>, name: string): string {
  const value = args[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required`)
  }
  return value
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function abortError(signal: AbortSignal): Error {
  const error = new Error(signal.reason ? String(signal.reason) : 'Operation aborted')
  error.name = 'AbortError'
  return error
}

/**
 * One request, cancelled through the service when the signal aborts. A request id names the
 * tool call so the service can refuse a duplicate and cancel exactly this one.
 */
async function invoke(
  context: UserLocalFilesystemToolContext,
  request: LocalFilesystemRequest
): Promise<LocalFilesystemData> {
  const { signal } = context
  if (signal?.aborted) throw abortError(signal)
  const requestId = 'requestId' in request ? request.requestId : undefined
  const onAbort = () => {
    if (requestId) void context.invoke({ operation: 'cancel', requestId })
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await context.invoke(request)
    if (!response.ok) throw new Error(response.error)
    if (signal?.aborted) throw abortError(signal)
    return response.data
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

function vfsPathForUri(
  context: UserLocalFilesystemToolContext,
  mount: LocalFilesystemMount,
  uri: string
): string {
  const parsed = new URL(uri)
  if (parsed.protocol !== 'localfs:' || parsed.hostname !== mount.id) {
    throw new Error('The desktop app returned a local path outside the selected folder.')
  }
  const relativePath = parsed.pathname.replace(/^\/+/, '')
  const root = context.vfsRoot(mount)
  return relativePath ? `${root}/${relativePath}` : root
}

function localUriForVfsPath(
  context: UserLocalFilesystemToolContext,
  mount: LocalFilesystemMount,
  path: string
): string {
  const root = context.vfsRoot(mount)
  if (path === root) return mount.uri
  if (!path.startsWith(`${root}/`)) {
    throw new Error(`Path is not inside a granted user-local folder: ${path}`)
  }
  return `${mount.uri}${path.slice(root.length + 1)}`
}

async function listMounts(
  context: UserLocalFilesystemToolContext
): Promise<LocalFilesystemMount[]> {
  const data = await invoke(context, { operation: 'list_mounts' })
  if (!('mounts' in data)) {
    throw new Error('The desktop app returned an invalid mount list.')
  }
  return data.mounts
}

function mountForPath(
  context: UserLocalFilesystemToolContext,
  mounts: LocalFilesystemMount[],
  path: string
): LocalFilesystemMount {
  const match = mounts.find((mount) => {
    const root = context.vfsRoot(mount)
    return path === root || path.startsWith(`${root}/`)
  })
  if (!match) {
    throw new Error(
      `No granted user-local folder contains "${path}". Use glob({pattern:"user-local/**"}) to discover canonical paths.`
    )
  }
  return match
}

async function glob(
  context: UserLocalFilesystemToolContext,
  requestId: string,
  args: Record<string, unknown>
): Promise<{ files: string[] }> {
  const pattern = requiredString(args, 'pattern')
  const mounts = await listMounts(context)
  const files = new Set<string>()

  for (const mount of mounts) {
    if (context.signal?.aborted) throw abortError(context.signal)
    const root = context.vfsRoot(mount)
    if (micromatch.isMatch(root, pattern, VFS_GLOB_OPTIONS)) {
      files.add(root)
    }

    const data = await invoke(context, {
      operation: 'glob',
      uri: mount.uri,
      pattern,
      pathPrefix: root,
      requestId,
    })
    if (!('entries' in data)) {
      throw new Error('The desktop app returned an invalid glob result.')
    }
    for (const entry of data.entries) {
      const path = vfsPathForUri(context, mount, entry.uri)
      if (micromatch.isMatch(path, pattern, VFS_GLOB_OPTIONS)) {
        files.add(path)
        if (files.size >= MAX_USER_LOCAL_GLOB_RESULTS) break
      }
    }
    if (files.size >= MAX_USER_LOCAL_GLOB_RESULTS) break
  }

  return { files: [...files].sort() }
}

async function read(
  context: UserLocalFilesystemToolContext,
  requestId: string,
  args: Record<string, unknown>
): Promise<{ content: string; totalLines: number }> {
  const path = requiredString(args, 'path')
  const mounts = await listMounts(context)
  const mount = mountForPath(context, mounts, path)
  const offset = Math.max(0, Math.trunc(optionalNumber(args.offset) ?? 0))
  const requestedLimit = optionalNumber(args.limit)
  const lineCount = Math.min(
    MAX_READ_LINES,
    Math.max(1, Math.trunc(requestedLimit ?? DEFAULT_READ_LINES))
  )
  const data = await invoke(context, {
    operation: 'read',
    uri: localUriForVfsPath(context, mount, path),
    startLine: offset + 1,
    lineCount,
    requestId,
  })
  if (!('content' in data) || !('totalLines' in data)) {
    throw new Error('The desktop app returned an invalid read result.')
  }
  return { content: data.content, totalLines: data.totalLines }
}

async function grep(
  context: UserLocalFilesystemToolContext,
  requestId: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const pattern = requiredString(args, 'pattern')
  const path = requiredString(args, 'path').replace(/\/+$/, '')
  const outputMode =
    args.output_mode === 'files_with_matches' || args.output_mode === 'count'
      ? args.output_mode
      : 'content'
  const maxResults = Math.min(
    MAX_GREP_RESULTS,
    Math.max(1, Math.trunc(optionalNumber(args.maxResults) ?? DEFAULT_GREP_RESULTS))
  )
  const mounts = await listMounts(context)
  const targets =
    path === USER_LOCAL_VFS_ROOT
      ? mounts.map((mount) => ({ mount, uri: mount.uri }))
      : (() => {
          const mount = mountForPath(context, mounts, path)
          return [{ mount, uri: localUriForVfsPath(context, mount, path) }]
        })()

  const contentMatches: Array<{ path: string; line: number; content: string }> = []
  const matchingFiles = new Set<string>()
  const counts = new Map<string, number>()

  for (const target of targets) {
    const data = await invoke(context, {
      operation: 'grep',
      uri: target.uri,
      pattern,
      caseSensitive: args.ignoreCase !== true,
      maxResults,
      outputMode,
      lineNumbers: args.lineNumbers !== false,
      context: Math.min(
        MAX_GREP_CONTEXT,
        Math.max(0, Math.trunc(optionalNumber(args.context) ?? DEFAULT_GREP_CONTEXT))
      ),
      requestId,
    })

    if ('matches' in data) {
      for (const match of data.matches) {
        contentMatches.push({
          path: vfsPathForUri(context, target.mount, match.uri),
          line: match.line,
          content: match.text,
        })
        if (contentMatches.length >= maxResults) break
      }
    } else if ('files' in data) {
      for (const uri of data.files) {
        matchingFiles.add(vfsPathForUri(context, target.mount, uri))
        if (matchingFiles.size >= maxResults) break
      }
    } else if ('counts' in data) {
      for (const count of data.counts) {
        counts.set(vfsPathForUri(context, target.mount, count.uri), count.count)
        if (counts.size >= maxResults) break
      }
    } else {
      throw new Error('The desktop app returned an invalid grep result.')
    }

    const currentCount =
      outputMode === 'files_with_matches'
        ? matchingFiles.size
        : outputMode === 'count'
          ? counts.size
          : contentMatches.length
    if (currentCount >= maxResults) break
  }

  if (outputMode === 'files_with_matches') {
    return { files: [...matchingFiles].sort() }
  }
  if (outputMode === 'count') {
    return {
      counts: [...counts.entries()]
        .map(([countPath, count]) => ({ path: countPath, count }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    }
  }
  return {
    matches: contentMatches.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line),
  }
}

/**
 * Runs one user-local `read`, `grep` or `glob` tool call. The tool call id is the request id, so
 * the service can cancel it and refuse to run it twice at once.
 */
export async function runUserLocalFilesystemTool(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
  context: UserLocalFilesystemToolContext
): Promise<Record<string, unknown>> {
  if (toolName === 'glob') return glob(context, toolCallId, args)
  if (toolName === 'grep') return grep(context, toolCallId, args)
  return read(context, toolCallId, args)
}
