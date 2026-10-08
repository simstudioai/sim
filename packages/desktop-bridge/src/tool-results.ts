/**
 * What a desktop tool call reports to Sim once it finishes, built the same way whichever process
 * ran it: the chat view (for a turn it serves) or the desktop app's background executor (for a
 * turn bound to it). One projection per surface keeps the model's view of a result identical on
 * both paths.
 */
import type { BrowserToolName } from '@sim/browser-protocol'
import type { TerminalOperation, TerminalToolResponse } from '@sim/terminal-protocol'
import { isRecordLike, toRecordOrNull } from '@sim/utils/object'
import {
  type DesktopLocalFileEntry,
  type DesktopLocalFileManifest,
  type DesktopLocalFileRequest,
  type DesktopLocalFileResponse,
  isStorableImportName,
  MAX_DESKTOP_IMPORT_FILE_BYTES,
} from './local-files'

type DesktopToolCompletionStatus = 'success' | 'error' | 'cancelled'

export interface DesktopToolCompletion {
  status: DesktopToolCompletionStatus
  message: string
  data?: Record<string, unknown>
}

/**
 * Tools that do not need an existing live page: most create one, and `browser_list_sessions`
 * reads the profile-level session registry. Every other tool fails fast on a closed session
 * instead of waiting out its timeout.
 */
const LIVE_PAGE_OPTIONAL_BROWSER_TOOLS: ReadonlySet<BrowserToolName> = new Set<BrowserToolName>([
  'browser_navigate',
  'browser_open_url',
  'browser_open_tab',
  'browser_list_tabs',
  'browser_list_sessions',
  'browser_list_downloads',
  'browser_save_download',
])

export function browserToolNeedsLivePage(toolName: BrowserToolName): boolean {
  return !LIVE_PAGE_OPTIONAL_BROWSER_TOOLS.has(toolName)
}

const BROWSER_SESSION_CLOSED_MESSAGE =
  'The agent browser session is closed, so this browser tool cannot run. ' +
  'Call browser_open_url, browser_navigate, or browser_open_tab to start a new session, or report the situation to the user. ' +
  'Do not retry other browser tools until a new session is open.'

/** A browser tool refused because its chat has no live page to act on. */
export function browserSessionClosedCompletion(): DesktopToolCompletion {
  return {
    status: 'error',
    message: BROWSER_SESSION_CLOSED_MESSAGE,
    data: { error: BROWSER_SESSION_CLOSED_MESSAGE, sessionClosed: true },
  }
}

/** What the model learns when the browser did not answer within the tool's deadline. */
export function browserToolTimeoutMessage(timeoutMs: number): string {
  return `The browser did not respond within ${timeoutMs}ms. Its outcome is unknown and the action may already have taken effect. Do not retry it automatically; take a fresh browser snapshot before deciding what to do.`
}

/** A browser tool that failed; `sessionClosed` adds the guidance for reopening a session. */
export function browserToolFailure(
  error: string,
  options: { outcomeUnknown?: boolean; sessionClosed?: boolean } = {}
): DesktopToolCompletion {
  const message = options.sessionClosed ? `${error} ${BROWSER_SESSION_CLOSED_MESSAGE}` : error
  return {
    status: 'error',
    message,
    data: {
      error: message,
      ...(options.outcomeUnknown ? { outcomeUnknown: true, doNotRetry: true } : {}),
      ...(options.sessionClosed ? { sessionClosed: true } : {}),
    },
  }
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function imageDimensions(value: unknown): { width: number; height: number } | null {
  if (
    !isRecordLike(value) ||
    !finiteNumber(value.width) ||
    !finiteNumber(value.height) ||
    value.width <= 0 ||
    value.height <= 0
  ) {
    return null
  }
  return { width: value.width, height: value.height }
}

/** Projects image bytes and coordinate metadata into the model's image-content contract. */
export function sanitizeBrowserToolResultForModel(
  toolName: BrowserToolName,
  result: unknown
): Record<string, unknown> | undefined {
  if (!isRecordLike(result)) {
    return result === undefined ? undefined : { value: result }
  }
  if (toolName !== 'browser_screenshot' || typeof result.dataUrl !== 'string') return result

  const { dataUrl, ...rest } = result
  const image = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl)
  if (!image) {
    return {
      ...rest,
      note: 'The screenshot could not be encoded. Use browser_snapshot or browser_read_text instead.',
    }
  }
  const viewport = toRecordOrNull(rest.viewport)
  const screenshotUrl =
    typeof rest.url === 'string' && rest.url
      ? rest.url
      : viewport && typeof viewport.url === 'string'
        ? viewport.url
        : ''
  const location = screenshotUrl ? ` of ${screenshotUrl}` : ''
  const clip = toRecordOrNull(rest.clip)
  const cropSize = imageDimensions(clip)
  const viewportSize = imageDimensions(viewport)
  const imageSize = imageDimensions(rest.imageSize)
  const capturedSize = clip ? cropSize : viewportSize
  const scaleX = imageSize && capturedSize ? imageSize.width / capturedSize.width : null
  const scaleY = imageSize && capturedSize ? imageSize.height / capturedSize.height : null
  const hasScale = finiteNumber(scaleX) && scaleX > 0 && finiteNumber(scaleY) && scaleY > 0
  const origin = clip
    ? finiteNumber(clip.x) && finiteNumber(clip.y)
      ? { x: clip.x, y: clip.y }
      : null
    : { x: 0, y: 0 }
  const content = [
    `Screenshot${location}. This is the rendered ${clip ? 'element' : 'viewport'} only — it carries no element ids. Use browser_snapshot for element-ref actions and the mapping below for coordinate actions.`,
    viewportSize && `Viewport: ${viewportSize.width} × ${viewportSize.height} CSS pixels.`,
    imageSize && `Encoded image: ${imageSize.width} × ${imageSize.height} pixels.`,
    hasScale && `Image scale: X=${scaleX}, Y=${scaleY} encoded image pixels per CSS pixel.`,
    cropSize && `Crop size: ${cropSize.width} × ${cropSize.height} CSS pixels.`,
    clip && origin && `Crop origin: (${origin.x}, ${origin.y}) in viewport CSS pixels.`,
    hasScale && origin
      ? `Coordinate actions use viewport CSS pixels: cssX = ${origin.x} + imageX / ${scaleX}; cssY = ${origin.y} + imageY / ${scaleY}. imageX/imageY refer to the encoded image before any display resizing.`
      : 'Screenshot coordinate mapping is unavailable; use browser_snapshot element references or take a new viewport screenshot before coordinate actions.',
  ]
    .filter(Boolean)
    .join(' ')
  return {
    ...rest,
    content,
    attachment: {
      type: 'image',
      source: { type: 'base64', media_type: image[1], data: image[2] },
    },
  }
}

/**
 * A browser tool the desktop ran to the end. A partial form fill, a failed batch step, or an
 * action whose outcome the driver could not confirm is reported as an error so the model
 * inspects the page before acting on it.
 */
export function browserToolCompletion(
  toolName: BrowserToolName,
  result: unknown
): DesktopToolCompletion {
  const record = isRecordLike(result) ? result : null
  const outcomeUnknown = record?.outcomeUnknown === true
  const stoppedMessage =
    toolName === 'browser_fill_form' && record?.completed === false
      ? 'Form filling stopped; inspect the partial result'
      : toolName === 'browser_batch' && record?.stoppedBy === 'failure'
        ? 'A batched browser action failed; inspect the partial result'
        : undefined
  return {
    status: stoppedMessage || outcomeUnknown ? 'error' : 'success',
    message:
      stoppedMessage ??
      (outcomeUnknown
        ? 'Browser action outcome is unconfirmed; inspect the page before repeating it.'
        : record?.effectObserved === false
          ? 'Browser input completed; its effect is unconfirmed. Inspect the current state before retrying.'
          : 'Browser action completed'),
    data: sanitizeBrowserToolResultForModel(toolName, result),
  }
}

/** A terminal operation that failed, with the terminal's error code when it gave one. */
export function terminalToolFailure(error: string, code?: string): DesktopToolCompletion {
  return { status: 'error', message: error, data: { error, ...(code ? { code } : {}) } }
}

/** A terminal operation's outcome as the terminal service returned it. */
export function terminalToolCompletion(response: TerminalToolResponse): DesktopToolCompletion {
  if (!response.ok) {
    return terminalToolFailure(response.error || 'The terminal reported an error', response.code)
  }
  return {
    status: 'success',
    message: 'Terminal action completed',
    ...(isRecordLike(response.result) ? { data: response.result } : {}),
  }
}

const QUICK_TERMINAL_OPERATION_TIMEOUT_MS = 15_000

/**
 * How long a terminal operation may take before it is reported as unresponsive. `run` waits on a
 * command and `handoff` on a person, and both bound themselves; everything else is near-instant,
 * so a short deadline keeps a wedged terminal from stalling the turn.
 */
export function terminalOperationTimeoutMs(operation: TerminalOperation): number | null {
  return operation === 'run' || operation === 'handoff' ? null : QUICK_TERMINAL_OPERATION_TIMEOUT_MS
}

/** A `read_local_file` call's outcome; the read itself never changes anything on the machine. */
export function localFileReadCompletion(response: DesktopLocalFileResponse): DesktopToolCompletion {
  if (!response.ok)
    return { status: 'error', message: response.error, data: { error: response.error } }
  if (response.data.kind !== 'read') {
    const error = 'The desktop app returned an unexpected local file result.'
    return { status: 'error', message: error, data: { error } }
  }
  return {
    status: 'success',
    message: 'Local file operation completed.',
    data: { ...response.data },
  }
}

/**
 * Refuses, before anything lands, an import Sim could not store whole: a file larger than desktop
 * imports carry, or a name with a backslash, which Sim's file names cannot hold.
 */
export function assertImportableManifest(manifest: DesktopLocalFileManifest): void {
  if (
    manifest.entries.some(
      (entry) => entry.kind === 'file' && entry.size > MAX_DESKTOP_IMPORT_FILE_BYTES
    )
  ) {
    throw new Error(
      'Desktop imports support files up to 64 MB. Use the file uploader for larger files.'
    )
  }
  const unstorable = [
    manifest.name,
    ...manifest.entries.flatMap((entry) =>
      entry.relativePath === '' ? [] : entry.relativePath.split('/')
    ),
  ].find((name) => !isStorableImportName(name))
  if (unstorable !== undefined) {
    throw new Error(
      `Sim cannot store a file or folder named "${unstorable}": a name needs visible characters, and cannot be "." or ".." or contain a backslash. Rename it, or import the rest separately.`
    )
  }
}

/**
 * Reads one manifest file in chunks, refusing a file that changed since the manifest listed it:
 * a different size, an early end, or a chunk past its length.
 */
export async function readImportEntry(
  toolCallId: string,
  entry: DesktopLocalFileEntry,
  readChunk: (request: DesktopLocalFileRequest) => Promise<DesktopLocalFileResponse>,
  signal?: AbortSignal
): Promise<Uint8Array<ArrayBuffer>[]> {
  const parts: Uint8Array<ArrayBuffer>[] = []
  let offset = 0
  do {
    signal?.throwIfAborted()
    const response = await readChunk({
      operation: 'chunk',
      toolCallId,
      relativePath: entry.relativePath,
      offset,
      revision: entry.revision,
    })
    if (!response.ok) throw new Error(response.error)
    if (response.data.kind !== 'chunk') throw new Error('Unexpected file chunk response.')
    const bytes = new Uint8Array(response.data.bytes)
    parts.push(bytes)
    offset += bytes.length
    if (
      offset > entry.size ||
      (response.data.eof && offset !== entry.size) ||
      (!response.data.eof && (bytes.length === 0 || offset >= entry.size))
    ) {
      throw new Error('The local file changed or its transfer was incomplete.')
    }
    if (response.data.eof) break
  } while (offset < entry.size)
  return parts
}

/** What an `import_local_files` call created, and how far it got when it stopped short. */
export interface DesktopLocalFileImportResult {
  success: boolean
  workspaceId: string
  files: Array<{ id: string; name: string; relativePath: string }>
  folders: Array<{ id: string; relativePath: string }>
  error?: string
  partial?: boolean
  doNotRetry?: true
  outcomeUnknown?: true
}

/**
 * An import that stopped part way. Files it already created stay. Usually whether more landed than
 * it reports is unknown, so the model inspects the workspace instead of importing again. With
 * `outcomeKnown` (Sim refused the next entry outright), the list is exact, and an import where
 * nothing landed can simply be asked for again.
 */
export function localFileImportFailure(
  partial: Pick<DesktopLocalFileImportResult, 'workspaceId' | 'files' | 'folders'>,
  error: string,
  options: { outcomeKnown?: boolean } = {}
): DesktopLocalFileImportResult {
  const landed = partial.files.length > 0 || partial.folders.length > 0
  return {
    success: false,
    ...partial,
    error,
    partial: landed,
    ...(landed || !options.outcomeKnown ? { doNotRetry: true as const } : {}),
    ...(options.outcomeKnown ? {} : { outcomeUnknown: true as const }),
  }
}

/** An `import_local_files` call's outcome. */
export function localFileImportCompletion(
  result: DesktopLocalFileImportResult
): DesktopToolCompletion {
  return result.success
    ? { status: 'success', message: 'Local file operation completed.', data: { ...result } }
    : {
        status: 'error',
        message: 'Some files could not be imported; inspect the partial result.',
        data: { ...result },
      }
}

/** A user-local folder read (`read`, `grep`, `glob`) the desktop finished or failed. */
export function localFilesystemToolCompletion(
  outcome: { ok: true; data: Record<string, unknown> } | { ok: false; error: string }
): DesktopToolCompletion {
  return outcome.ok
    ? { status: 'success', message: 'Local filesystem tool completed.', data: outcome.data }
    : { status: 'error', message: outcome.error, data: { error: outcome.error } }
}
