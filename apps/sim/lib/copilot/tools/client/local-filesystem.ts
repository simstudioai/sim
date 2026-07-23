import type {
  LocalFilesystemData,
  LocalFilesystemMount,
  LocalFilesystemRequest,
  LocalFilesystemResponse,
} from '@sim/desktop-bridge'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import micromatch from 'micromatch'
import { ASYNC_TOOL_CONFIRMATION_STATUS } from '@/lib/copilot/async-runs/lifecycle'
import { reportClientToolCompletion } from '@/lib/copilot/tools/client/completion'
import {
  isUserLocalVfsToolCall,
  LOCAL_FILESYSTEM_TOOL_NAMES,
  USER_LOCAL_VFS_ROOT,
} from '@/lib/copilot/tools/local-filesystem'
import { encodeVfsSegment } from '@/lib/copilot/vfs/path-utils'
import { getDesktopBridge } from '@/lib/desktop'

const logger = createLogger('CopilotLocalFilesystemTool')
const MAX_USER_LOCAL_GLOB_RESULTS = 500
const MAX_USER_LOCAL_GREP_RESULTS = 200

const VFS_GLOB_OPTIONS: micromatch.Options = {
  bash: false,
  dot: false,
  windows: false,
  nobrace: true,
  noext: true,
}

interface LocalFilesystemExecutionContext {
  workspaceId: string
  chatId?: string
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

function bridge(): NonNullable<Window['simDesktop']> {
  const desktop = getDesktopBridge()
  if (!desktop?.localFilesystem) {
    throw new Error('The desktop local filesystem bridge is unavailable.')
  }
  return desktop
}

function successfulData(response: LocalFilesystemResponse): LocalFilesystemData {
  if (!response.ok) {
    throw new Error(response.error)
  }
  return response.data
}

function abortError(signal: AbortSignal): Error {
  const error = new Error(signal.reason ? String(signal.reason) : 'Operation aborted')
  error.name = 'AbortError'
  return error
}

function requestIdForToolCall(toolCallId: string): string {
  return toolCallId
}

async function invokeBridge(
  request: LocalFilesystemRequest,
  signal?: AbortSignal
): Promise<LocalFilesystemData> {
  if (signal?.aborted) throw abortError(signal)
  const requestId = 'requestId' in request ? request.requestId : undefined
  const onAbort = () => {
    if (requestId) {
      void bridge().localFilesystem({ operation: 'cancel', requestId })
    }
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const data = successfulData(await bridge().localFilesystem(request))
    if (signal?.aborted) throw abortError(signal)
    return data
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

function encodeMountName(name: string): string {
  try {
    return encodeVfsSegment(name)
  } catch {
    return encodeURIComponent(name)
  }
}

function mountVfsRoot(mount: LocalFilesystemMount): string {
  return `${USER_LOCAL_VFS_ROOT}/${encodeMountName(mount.name)}--${mount.id}`
}

function vfsPathForUri(mount: LocalFilesystemMount, uri: string): string {
  const parsed = new URL(uri)
  if (parsed.protocol !== 'localfs:' || parsed.hostname !== mount.id) {
    throw new Error('The desktop app returned a local path outside the selected folder.')
  }
  const relativePath = parsed.pathname.replace(/^\/+/, '')
  return relativePath ? `${mountVfsRoot(mount)}/${relativePath}` : mountVfsRoot(mount)
}

function localUriForVfsPath(mount: LocalFilesystemMount, path: string): string {
  const root = mountVfsRoot(mount)
  if (path === root) return mount.uri
  if (!path.startsWith(`${root}/`)) {
    throw new Error(`Path is not inside a granted user-local folder: ${path}`)
  }
  return `${mount.uri}${path.slice(root.length + 1)}`
}

async function listMounts(): Promise<LocalFilesystemMount[]> {
  const data = await invokeBridge({ operation: 'list_mounts' })
  if (!('mounts' in data)) {
    throw new Error('The desktop app returned an invalid mount list.')
  }
  return data.mounts
}

function mountForPath(mounts: LocalFilesystemMount[], path: string): LocalFilesystemMount {
  const match = mounts.find((mount) => {
    const root = mountVfsRoot(mount)
    return path === root || path.startsWith(`${root}/`)
  })
  if (!match) {
    throw new Error(
      `No granted user-local folder contains "${path}". Use glob({pattern:"user-local/**"}) to discover canonical paths.`
    )
  }
  return match
}

function requestForLegacyTool(
  toolName: string,
  args: Record<string, unknown>,
  requestId: string
): LocalFilesystemRequest {
  switch (toolName) {
    case LOCAL_FILESYSTEM_TOOL_NAMES.mountDirectory:
      throw new Error(
        'Folder access requires an explicit user click. Ask the user to use the folder access control.'
      )
    case LOCAL_FILESYSTEM_TOOL_NAMES.listMounts:
      return { operation: 'list_mounts' }
    case LOCAL_FILESYSTEM_TOOL_NAMES.forgetMount:
      throw new Error(
        'Revoking folder access requires an explicit user action in Desktop settings.'
      )
    case LOCAL_FILESYSTEM_TOOL_NAMES.list:
      return { operation: 'list', uri: requiredString(args, 'uri'), requestId }
    case LOCAL_FILESYSTEM_TOOL_NAMES.glob:
      return {
        operation: 'glob',
        uri: requiredString(args, 'uri'),
        pattern: requiredString(args, 'pattern'),
        requestId,
      }
    case LOCAL_FILESYSTEM_TOOL_NAMES.read:
      return {
        operation: 'read',
        uri: requiredString(args, 'uri'),
        ...(typeof args.startLine === 'number' ? { startLine: args.startLine } : {}),
        ...(typeof args.lineCount === 'number' ? { lineCount: args.lineCount } : {}),
        requestId,
      }
    case LOCAL_FILESYSTEM_TOOL_NAMES.grep:
      return {
        operation: 'grep',
        uri: requiredString(args, 'uri'),
        query: requiredString(args, 'query'),
        ...(typeof args.include === 'string' ? { include: args.include } : {}),
        ...(typeof args.caseSensitive === 'boolean' ? { caseSensitive: args.caseSensitive } : {}),
        requestId,
      }
    case LOCAL_FILESYSTEM_TOOL_NAMES.stat:
      return { operation: 'stat', uri: requiredString(args, 'uri'), requestId }
    case LOCAL_FILESYSTEM_TOOL_NAMES.stageFile:
      throw new Error(
        'local_stage_file is retired. Local files are read-only under user-local/ and cannot be uploaded by the model.'
      )
    default:
      throw new Error(`Unsupported local filesystem tool: ${toolName}`)
  }
}

function omitHostPaths(data: LocalFilesystemData): LocalFilesystemData {
  if ('mount' in data) {
    if (!data.mount) return data
    const { path: _path, ...mount } = data.mount as LocalFilesystemMount & { path?: unknown }
    return { ...data, mount }
  }
  if ('mounts' in data) {
    return {
      ...data,
      mounts: data.mounts.map((rawMount) => {
        const { path: _path, ...mount } = rawMount as LocalFilesystemMount & { path?: unknown }
        return mount
      }),
    }
  }
  return data
}

async function executeUserLocalGlob(
  toolCallId: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ files: string[] }> {
  const pattern = requiredString(args, 'pattern')
  const mounts = await listMounts()
  const files = new Set<string>()
  const requestId = requestIdForToolCall(toolCallId)

  for (const mount of mounts) {
    if (signal?.aborted) throw abortError(signal)
    const root = mountVfsRoot(mount)
    if (micromatch.isMatch(root, pattern, VFS_GLOB_OPTIONS)) {
      files.add(root)
    }

    const data = await invokeBridge(
      {
        operation: 'glob',
        uri: mount.uri,
        pattern,
        pathPrefix: root,
        requestId,
      },
      signal
    )
    if (!('entries' in data)) {
      throw new Error('The desktop app returned an invalid glob result.')
    }
    for (const entry of data.entries) {
      const path = vfsPathForUri(mount, entry.uri)
      if (micromatch.isMatch(path, pattern, VFS_GLOB_OPTIONS)) {
        files.add(path)
        if (files.size >= MAX_USER_LOCAL_GLOB_RESULTS) break
      }
    }
    if (files.size >= MAX_USER_LOCAL_GLOB_RESULTS) break
  }

  return { files: [...files].sort() }
}

async function executeUserLocalRead(
  toolCallId: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ content: string; totalLines: number }> {
  const path = requiredString(args, 'path')
  const mounts = await listMounts()
  const mount = mountForPath(mounts, path)
  const offset = Math.max(0, Math.trunc(optionalNumber(args.offset) ?? 0))
  const requestedLimit = optionalNumber(args.limit)
  const lineCount = Math.min(2000, Math.max(1, Math.trunc(requestedLimit ?? 2000)))
  const data = await invokeBridge(
    {
      operation: 'read',
      uri: localUriForVfsPath(mount, path),
      startLine: offset + 1,
      lineCount,
      requestId: requestIdForToolCall(toolCallId),
    },
    signal
  )
  if (!('content' in data) || !('totalLines' in data)) {
    throw new Error('The desktop app returned an invalid read result.')
  }
  return { content: data.content, totalLines: data.totalLines }
}

async function executeUserLocalGrep(
  toolCallId: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const pattern = requiredString(args, 'pattern')
  const path = requiredString(args, 'path').replace(/\/+$/, '')
  const outputMode =
    args.output_mode === 'files_with_matches' || args.output_mode === 'count'
      ? args.output_mode
      : 'content'
  const maxResults = Math.min(
    MAX_USER_LOCAL_GREP_RESULTS,
    Math.max(1, Math.trunc(optionalNumber(args.maxResults) ?? 50))
  )
  const mounts = await listMounts()
  const targets =
    path === USER_LOCAL_VFS_ROOT
      ? mounts.map((mount) => ({ mount, uri: mount.uri }))
      : [
          {
            mount: mountForPath(mounts, path),
            uri: '',
          },
        ]
  if (targets.length === 1 && !targets[0].uri) {
    targets[0].uri = localUriForVfsPath(targets[0].mount, path)
  }

  const contentMatches: Array<{ path: string; line: number; content: string }> = []
  const matchingFiles = new Set<string>()
  const counts = new Map<string, number>()
  const requestId = requestIdForToolCall(toolCallId)

  for (const target of targets) {
    const data = await invokeBridge(
      {
        operation: 'grep',
        uri: target.uri,
        pattern,
        caseSensitive: args.ignoreCase !== true,
        maxResults,
        outputMode,
        lineNumbers: args.lineNumbers !== false,
        context: Math.min(20, Math.max(0, Math.trunc(optionalNumber(args.context) ?? 0))),
        requestId,
      },
      signal
    )

    if ('matches' in data) {
      for (const match of data.matches) {
        contentMatches.push({
          path: vfsPathForUri(target.mount, match.uri),
          line: match.line,
          content: match.text,
        })
        if (contentMatches.length >= maxResults) break
      }
    } else if ('files' in data) {
      for (const uri of data.files) {
        matchingFiles.add(vfsPathForUri(target.mount, uri))
        if (matchingFiles.size >= maxResults) break
      }
    } else if ('counts' in data) {
      for (const count of data.counts) {
        counts.set(vfsPathForUri(target.mount, count.uri), count.count)
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

async function execute(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
  context: LocalFilesystemExecutionContext
): Promise<unknown> {
  if (isUserLocalVfsToolCall(toolName, args)) {
    if (toolName === 'glob') return executeUserLocalGlob(toolCallId, args, context.signal)
    if (toolName === 'grep') return executeUserLocalGrep(toolCallId, args, context.signal)
    return executeUserLocalRead(toolCallId, args, context.signal)
  }

  return omitHostPaths(
    await invokeBridge(
      requestForLegacyTool(toolName, args, requestIdForToolCall(toolCallId)),
      context.signal
    )
  )
}

export function executeLocalFilesystemTool(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
  context: LocalFilesystemExecutionContext
): void {
  void execute(toolCallId, toolName, args, context).then(
    async (data) => {
      if (context.signal?.aborted) return
      try {
        await reportClientToolCompletion(
          toolCallId,
          ASYNC_TOOL_CONFIRMATION_STATUS.success,
          'Local filesystem tool completed.',
          data
        )
      } catch (reportError) {
        logger.error('Failed to report local filesystem tool completion', {
          toolCallId,
          toolName,
          error: toError(reportError).message,
        })
      }
    },
    async (error) => {
      if (context.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return
      }
      const message = toError(error).message
      logger.warn('Local filesystem tool failed', { toolCallId, toolName, error: message })
      try {
        await reportClientToolCompletion(
          toolCallId,
          ASYNC_TOOL_CONFIRMATION_STATUS.error,
          message,
          { error: message }
        )
      } catch (reportError) {
        logger.error('Failed to report local filesystem tool error', {
          toolCallId,
          toolName,
          error: toError(reportError).message,
        })
      }
    }
  )
}

export const userLocalVfsTestHelpers = {
  mountVfsRoot,
  vfsPathForUri,
  localUriForVfsPath,
}
