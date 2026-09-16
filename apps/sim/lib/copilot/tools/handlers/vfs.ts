import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { resolveCopilotKnowledgePrincipal } from '@/lib/copilot/application/execute-knowledge-use-case'
import { loadCopilotConnectedAccounts } from '@/lib/copilot/application/load-connected-accounts'
import { requireTrustedCopilotExecutionContext } from '@/lib/copilot/auth/application-delegation'
import { resolveCopilotFilePrincipal } from '@/lib/copilot/auth/file-delegation'
import { getBlockVisibilityForCopilot } from '@/lib/copilot/block-visibility'
import { TOOL_RESULT_MAX_INLINE_CHARS } from '@/lib/copilot/constants'
import {
  couldMatchDocsScope,
  DocsCorpusError,
  globDocs,
  grepDocs,
  isDocsPath,
  readDocsPage,
} from '@/lib/copilot/docs/docs-corpus'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { getOrMaterializeVFS } from '@/lib/copilot/vfs'
import type { GrepCountEntry, GrepMatch } from '@/lib/copilot/vfs/operations'
import { WorkspaceFileGrepError } from '@/lib/copilot/vfs/operations'
import { encodeVfsSegment } from '@/lib/copilot/vfs/path-utils'
import { isOversizedReadPlaceholder } from '@/lib/copilot/vfs/read-placeholders'
import {
  importWorkspaceFileSecretProvenanceForModelView,
  type WorkspaceFileSecretProvenanceIdentity,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { withBlockVisibility } from '@/blocks/visibility/server-context'
import {
  grepChatUploadWithProvenance,
  listChatUploads,
  readChatUploadWithProvenance,
} from './upload-file-reader'

const logger = createLogger('VfsTools')

/**
 * Materialize the workspace VFS inside the viewer's block-visibility context so
 * the static component files stamped into it exclude blocks gated for this
 * viewer (unrevealed previews, kill-switched types). Visibility is memoized per
 * (userId, workspaceId), so repeated tool calls in one turn resolve once.
 */
async function getGatedVFS(context: ExecutionContext) {
  const workspaceId = context.workspaceId
  if (!workspaceId) throw new Error('No workspace context available')
  const knowledgePrincipal = resolveCopilotKnowledgePrincipal(context)
  const connectedAccountsContext = requireTrustedCopilotExecutionContext(context)
  const vis = await getBlockVisibilityForCopilot(context.userId, workspaceId)
  const filePrincipal =
    context.copilotToolExecution && context.toolCallId
      ? resolveCopilotFilePrincipal(context)
      : undefined
  return withBlockVisibility(vis, () =>
    getOrMaterializeVFS(workspaceId, context.userId, {
      secretMountPolicy: context.secretMountPolicy,
      filePrincipal,
      knowledgePrincipal,
      loadConnectedAccounts: () => loadCopilotConnectedAccounts(connectedAccountsContext),
    })
  )
}

/**
 * Encode a chat-upload display name as a single canonical VFS path segment so
 * `uploads/` paths follow the same percent-encoded convention as `files/`.
 * Falls back to the raw name if the segment cannot be encoded (so a listing
 * never fails wholesale over one odd name).
 */
function encodeUploadSegment(name: string): string {
  try {
    return encodeVfsSegment(name)
  } catch {
    return name
  }
}

/**
 * True when a grep `path` targets the workspace files tree (`files/` or
 * `recently-deleted/files/`). Such greps search a single file's content via
 * {@link WorkspaceVFS.grepFile}; every other path searches the VFS map.
 */
function isWorkspaceFileGrepPath(path: string | undefined): path is string {
  if (!path) return false
  return /^(recently-deleted\/)?files(\/|$)/.test(path.replace(/^\/+/, ''))
}

/** True when a grep `path` targets the chat-scoped uploads namespace. */
function isChatUploadGrepPath(path: string | undefined): path is string {
  if (!path) return false
  return /^uploads(\/|$)/.test(path.replace(/^\/+/, ''))
}

function serializedResultSize(value: unknown): number {
  try {
    return JSON.stringify(value).length
  } catch {
    return String(value).length
  }
}

function hasModelAttachment(result: unknown): boolean {
  if (!result || typeof result !== 'object') {
    return false
  }
  const attachment = (result as { attachment?: { type?: string } }).attachment
  return (
    attachment?.type === 'image' || attachment?.type === 'file' || attachment?.type === 'document'
  )
}

async function canReturnWorkspaceFileValue(
  file: WorkspaceFileSecretProvenanceIdentity | undefined,
  value: unknown,
  context: ExecutionContext,
  view: 'complete' | 'derived',
  contributingFiles: readonly WorkspaceFileSecretProvenanceIdentity[] = []
): Promise<boolean> {
  if (!context.workspaceId) return true
  const files = new Map<string, WorkspaceFileSecretProvenanceIdentity>()
  for (const identity of file ? [file, ...contributingFiles] : contributingFiles) {
    files.set(`${identity.context}:${identity.fileId}:${identity.key}`, identity)
  }
  if (files.size === 0) return true

  const provenanceView = hasModelAttachment(value) ? 'opaque' : view
  for (const identity of files.values()) {
    if (
      !(await importWorkspaceFileSecretProvenanceForModelView({
        workspaceId: context.workspaceId,
        identity,
        registry: context.resolvedSecretTraceRegistry,
        view: provenanceView,
        value,
        actorUserId: context.userId,
      }))
    ) {
      return false
    }
  }
  return true
}

/**
 * Trim an oversized docs page to a whole-line prefix that fits the
 * inline budget, preserving the true `totalLines` so the model can page through
 * the rest with offset/limit. Returns null when not even one line fits — a
 * single line longer than the cap — so the caller can fail instead of returning
 * an over-cap payload as success. The notice offers grep as an alternative to
 * another read because either operation fetches the page once.
 */
function truncateDocsPageToInlineCap(page: { content: string; totalLines: number }): {
  output: { content: string; totalLines: number }
  returnedLines: number
} | null {
  const lines = page.content.split('\n')
  const notice = (shown: number) =>
    `\n\n[Page truncated: returned lines 1-${shown} of ${page.totalLines}. To continue, read this path with offset: ${shown} and limit: ${shown}; reduce the limit if that window is still too large. To jump straight to a section, grep this path INSTEAD of reading it — grep is the same single fetch and returns only matching lines with their numbers.]`

  let kept = lines.length
  while (kept > 0) {
    const content = `${lines.slice(0, kept).join('\n')}${notice(kept)}`
    if (
      serializedResultSize({ content, totalLines: page.totalLines }) <= TOOL_RESULT_MAX_INLINE_CHARS
    ) {
      return { output: { content, totalLines: page.totalLines }, returnedLines: kept }
    }
    kept = Math.floor(kept / 2)
  }
  return null
}

/**
 * Routes grep by content source. `docs/<page>` uses one network-backed docs
 * page; `uploads/<file>` uses one chat-scoped upload; workspace file paths use
 * one authorized file; all remaining paths use the materialized in-memory VFS.
 * External and dynamic file contents are therefore opt-in and single-target,
 * while an unscoped grep searches only static VFS resources and metadata.
 */
export async function executeVfsGrep(
  params: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const pattern = params.pattern as string | undefined
  if (!pattern) {
    return { success: false, error: "Missing required parameter 'pattern'" }
  }
  const outputMode = (params.output_mode as string) ?? 'content'

  const workspaceId = context.workspaceId
  if (!workspaceId) {
    return { success: false, error: 'No workspace context available' }
  }

  const rawPath = typeof params.path === 'string' ? params.path : undefined

  try {
    const grepOptions = {
      maxResults: (params.maxResults as number) ?? 50,
      outputMode: outputMode as 'content' | 'files_with_matches' | 'count',
      ignoreCase: (params.ignoreCase as boolean) ?? false,
      lineNumbers: (params.lineNumbers as boolean) ?? true,
      context: (params.context as number) ?? 0,
    }

    let result: GrepMatch[] | string[] | GrepCountEntry[]
    let provenanceFile: WorkspaceFileSecretProvenanceIdentity | undefined
    if (rawPath !== undefined && isDocsPath(rawPath)) {
      result = await grepDocs(rawPath, pattern, grepOptions, context.abortSignal)
    } else if (isChatUploadGrepPath(rawPath)) {
      if (!context.chatId) {
        return { success: false, error: 'No chat context available for uploads/' }
      }
      // The upload is the first segment after uploads/; any trailing segment
      // (e.g. a /content suffix) is ignored, mirroring the uploads read path.
      const filename = rawPath
        .replace(/^\/+/, '')
        .replace(/^uploads\/?/, '')
        .split('/')[0]
      if (!filename) {
        return {
          success: false,
          error:
            'Grep over chat uploads must target a single upload (e.g. path: "uploads/report.json"). Use glob("uploads/*") to list uploads.',
        }
      }
      const envelope = await grepChatUploadWithProvenance(
        filename,
        context.chatId,
        pattern,
        grepOptions
      )
      result = envelope.value
      provenanceFile = envelope.file
    } else {
      const vfs = await getGatedVFS(context)
      if (isWorkspaceFileGrepPath(rawPath)) {
        const envelope = await vfs.grepFileWithProvenance(rawPath, pattern, grepOptions)
        result = envelope.value
        provenanceFile = envelope.file
      } else {
        result = await vfs.grep(pattern, rawPath, grepOptions)
      }
    }
    const key =
      outputMode === 'files_with_matches' ? 'files' : outputMode === 'count' ? 'counts' : 'matches'
    const matchCount = Array.isArray(result)
      ? result.length
      : typeof result === 'object'
        ? Object.keys(result).length
        : 0
    const output = { [key]: result }
    if (!(await canReturnWorkspaceFileValue(provenanceFile, output, context, 'derived'))) {
      return {
        success: false,
        error:
          'This file result cannot be shared safely because its secret provenance is unavailable.',
      }
    }
    if (serializedResultSize(output) > TOOL_RESULT_MAX_INLINE_CHARS) {
      return {
        success: false,
        error:
          'Grep result too large to return inline. Retry grep with a more specific pattern or narrower path, and reduce context or maxResults. Avoid catch-all greps because smaller searches save context window and make follow-up reads cheaper.',
      }
    }
    logger.debug('vfs_grep result', { pattern, path: rawPath, outputMode, matchCount })
    return { success: true, output }
  } catch (err) {
    // Expected single-file scoping / no-text / too-large conditions: surface the
    // message verbatim instead of logging an internal failure.
    if (err instanceof WorkspaceFileGrepError || err instanceof DocsCorpusError) {
      logger.debug('vfs_grep single-file scope rejected', {
        pattern,
        path: rawPath,
        error: err.message,
      })
      return { success: false, error: err.message }
    }
    logger.error('vfs_grep failed', {
      pattern,
      path: rawPath,
      error: toError(err).message,
    })
    return { success: false, error: getErrorMessage(err, 'vfs_grep failed') }
  }
}

export async function executeVfsGlob(
  params: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const pattern = params.pattern as string | undefined
  if (!pattern) {
    return { success: false, error: "Missing required parameter 'pattern'" }
  }

  const workspaceId = context.workspaceId
  if (!workspaceId) {
    return { success: false, error: 'No workspace context available' }
  }

  try {
    if (couldMatchDocsScope(pattern)) {
      const files = globDocs(pattern)
      logger.debug('vfs_glob docs result', { pattern, fileCount: files.length })
      return { success: true, output: { files } }
    }

    const vfs = await getGatedVFS(context)
    let files = vfs.glob(pattern)

    if (context.chatId && (pattern === 'uploads/*' || pattern.startsWith('uploads/'))) {
      const uploads = await listChatUploads(context.chatId)
      // Encode per segment so uploads/ paths match the files/ convention; the
      // upload resolver accepts both the encoded path and the raw display name.
      const uploadPaths = uploads.map((f) => `uploads/${encodeUploadSegment(f.name)}`)
      files = [...files, ...uploadPaths]
    }

    logger.debug('vfs_glob result', { pattern, fileCount: files.length })
    // A bare [] on a namespace that is legitimately absent reads as "my glob is
    // wrong". Say why it's empty so the model doesn't retry pattern variants.
    if (files.length === 0) {
      if (pattern.startsWith('uploads')) {
        return {
          success: true,
          output: { files, note: 'This chat has no uploads.' },
        }
      }
      if (pattern.startsWith('user-local')) {
        return {
          success: true,
          output: {
            files,
            note: 'No user-local folder is granted in this chat, so user-local/ is empty.',
          },
        }
      }
    }
    return { success: true, output: { files } }
  } catch (err) {
    logger.error('vfs_glob failed', {
      pattern,
      error: toError(err).message,
    })
    return { success: false, error: getErrorMessage(err, 'vfs_glob failed') }
  }
}

export async function executeVfsRead(
  params: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const path = params.path as string | undefined
  if (!path) {
    return { success: false, error: "Missing required parameter 'path'" }
  }

  const workspaceId = context.workspaceId
  if (!workspaceId) {
    return { success: false, error: 'No workspace context available' }
  }

  try {
    const parseOptionalNumber = (value: unknown): number | undefined => {
      if (typeof value === 'number' && Number.isFinite(value)) return value
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number.parseInt(value, 10)
        return Number.isFinite(parsed) ? parsed : undefined
      }
      return undefined
    }
    const offset = parseOptionalNumber(params.offset)
    const limit = parseOptionalNumber(params.limit)
    /**
     * Applies the caller's line window, clamped against the content's ACTUAL line count rather than
     * the self-reported `totalLines`. Synthesized results report `totalLines: 1` for content that is
     * not one line (e.g. `files/x.pdf/extract` returns a whole extracted document), and clamping to
     * that collapses the read to its first line — or to nothing for any nonzero offset. An
     * attachment result is skipped outright: its `content` is a one-line label beside the bytes, so
     * a window can only blank the label while the model still receives the attachment.
     */
    const applyWindow = <T extends { content: string; totalLines: number }>(result: T): T => {
      if (offset === undefined && limit === undefined) return result
      if (hasModelAttachment(result)) return result
      const lines = result.content.split('\n')
      const start = Math.max(0, Math.min(lines.length, offset ?? 0))
      const endRaw = limit !== undefined ? start + Math.max(0, limit) : lines.length
      const end = Math.max(start, Math.min(lines.length, endRaw))
      return {
        ...result,
        content: lines.slice(start, end).join('\n'),
      }
    }

    if (isDocsPath(path)) {
      const page = await readDocsPage(path, context.abortSignal)
      const windowed = applyWindow(page)
      if (serializedResultSize(windowed) > TOOL_RESULT_MAX_INLINE_CHARS) {
        if (offset !== undefined || limit !== undefined) {
          return {
            success: false,
            error: `${path} is still too large over the requested window. Narrow offset/limit, or grep this page for the section you need.`,
          }
        }
        const truncated = truncateDocsPageToInlineCap(page)
        if (!truncated) {
          return {
            success: false,
            error: `${path} is too large to return inline even truncated. Grep this page for the section you need.`,
          }
        }
        logger.debug('vfs_read truncated oversized docs page', {
          path,
          totalLines: page.totalLines,
          returnedLines: truncated.returnedLines,
        })
        return { success: true, output: truncated.output }
      }
      logger.debug('vfs_read resolved docs page', { path, totalLines: page.totalLines })
      return { success: true, output: windowed }
    }

    // Handle chat-scoped uploads via the uploads/ virtual prefix.
    // Uploads are flat and have no metadata/content split like files/ — the upload
    // IS the first path segment after uploads/. Any trailing segment (e.g. a
    // /content suffix added out of habit) is ignored so the read resolves either way.
    if (path.startsWith('uploads/')) {
      if (!context.chatId) {
        return { success: false, error: 'No chat context available for uploads/' }
      }
      const filename = path.slice('uploads/'.length).split('/')[0]
      const uploadEnvelope = await readChatUploadWithProvenance(filename, context.chatId)
      const uploadResult = uploadEnvelope?.value
      if (uploadResult) {
        const isAttachment = hasModelAttachment(uploadResult)
        if (!isAttachment && isOversizedReadPlaceholder(uploadResult)) {
          // The loader refused to materialize the bytes at all; a window can't help.
          return { success: false, error: uploadResult.content }
        }
        // Window BEFORE the inline-size gate, so offset/limit genuinely page a
        // large upload instead of the gate rejecting the whole file first.
        const windowedUpload = applyWindow(uploadResult)
        if (!isAttachment && serializedResultSize(windowedUpload) > TOOL_RESULT_MAX_INLINE_CHARS) {
          logger.warn('Upload read result too large', {
            path,
            hasAttachment: isAttachment,
            contentLength: uploadResult.content.length,
            serializedSize: serializedResultSize(windowedUpload),
            windowed: offset !== undefined || limit !== undefined,
          })
          return {
            success: false,
            error:
              offset !== undefined || limit !== undefined
                ? `The requested window is still too large to return inline. Reduce limit (fewer lines per page) — e.g. read({path: "${path}", offset: ${offset ?? 0}, limit: 200}).`
                : `Read result too large to return inline. Page it — read({path: "${path}", offset: 0, limit: 500}) — or locate the relevant section first with grep({pattern: "...", path: "${path}"}).`,
          }
        }
        const provenanceView =
          offset === undefined && limit === undefined
            ? (uploadEnvelope?.view ?? 'derived')
            : 'derived'
        if (
          !(await canReturnWorkspaceFileValue(
            uploadEnvelope?.file,
            windowedUpload,
            context,
            provenanceView,
            uploadEnvelope?.contributingFiles
          ))
        ) {
          return {
            success: false,
            error:
              'This file result cannot be shared safely because its secret provenance is unavailable.',
          }
        }
        logger.debug('vfs_read resolved chat upload', {
          path,
          totalLines: uploadResult.totalLines,
          hasAttachment: isAttachment,
          offset,
          limit,
        })
        return { success: true, output: windowedUpload }
      }
      return {
        success: false,
        error: `Upload not found: ${path}. Use glob("uploads/*") to list available uploads.`,
      }
    }

    const vfs = await getGatedVFS(context)

    // Plain canonical file leaves are metadata resources. Dynamic file content
    // and inspection paths use explicit suffixes like /content, /style,
    // /compiled-check, or /compiled.
    const shouldReadDynamicFileContent =
      /^recently-deleted\/files\/.+\/content$/.test(path) ||
      /^files\/.+\/(?:content|style|compiled-check|compiled|render|extract)$/.test(path)
    const fileEnvelope = shouldReadDynamicFileContent
      ? await vfs.readFileContentWithProvenance(path)
      : null
    const fileContent = fileEnvelope?.value
    if (fileContent) {
      const isAttachment = hasModelAttachment(fileContent)
      if (!isAttachment && isOversizedReadPlaceholder(fileContent)) {
        // The loader refused to materialize the bytes at all; a window can't help.
        return { success: false, error: fileContent.content }
      }
      // Window BEFORE the inline-size gate, so offset/limit genuinely page a
      // large file instead of the gate rejecting the whole file first — the
      // paging advice in the error below has to actually work.
      const windowedFileContent = applyWindow(fileContent)
      if (
        !isAttachment &&
        serializedResultSize(windowedFileContent) > TOOL_RESULT_MAX_INLINE_CHARS
      ) {
        logger.warn('File read result too large', {
          path,
          hasAttachment: isAttachment,
          contentLength: fileContent.content.length,
          serializedSize: serializedResultSize(windowedFileContent),
          windowed: offset !== undefined || limit !== undefined,
        })
        return {
          success: false,
          error:
            offset !== undefined || limit !== undefined
              ? `The requested window is still too large to return inline. Reduce limit (fewer lines per page) — e.g. read({path: "${path}", offset: ${offset ?? 0}, limit: 200}).`
              : `Read result too large to return inline. Page it — read({path: "${path}", offset: 0, limit: 500}) — or locate the relevant section first with grep({pattern: "...", path: "${path}"}), then read({path: "${path}", offset: <line>, limit: <lines>}). Avoid catch-all greps or full-file reads because they waste context window.`,
        }
      }
      const provenanceView =
        offset === undefined && limit === undefined ? (fileEnvelope?.view ?? 'derived') : 'derived'
      if (
        !(await canReturnWorkspaceFileValue(
          fileEnvelope?.file,
          windowedFileContent,
          context,
          provenanceView,
          fileEnvelope?.contributingFiles
        ))
      ) {
        return {
          success: false,
          error:
            'This file result cannot be shared safely because its secret provenance is unavailable.',
        }
      }
      if (fileContent.error !== undefined) {
        return { success: false, error: fileContent.error }
      }
      logger.debug('vfs_read resolved workspace file', {
        path,
        totalLines: fileContent.totalLines,
        hasAttachment: isAttachment,
        offset,
        limit,
      })
      return {
        success: true,
        output:
          fileContent.content === '' && !isAttachment
            ? // An empty string with no explanation reads as a failed read.
              { ...windowedFileContent, note: 'File is empty (0 bytes).' }
            : windowedFileContent,
      }
    }

    let result = await vfs.read(path, offset, limit)
    if (!result) {
      // Same name, wrong encoding (spaces instead of %20) is the most common
      // path mistake and carries zero ambiguity — resolve it instead of
      // bouncing the model through a not-found round-trip.
      const decodedEquivalent = vfs.resolveDecodedEquivalent(path)
      if (decodedEquivalent) {
        logger.info('vfs_read resolved decoded-equivalent path', {
          requested: path,
          resolved: decodedEquivalent,
        })
        result = await vfs.read(decodedEquivalent, offset, limit)
      }
    }
    if (!result) {
      const suggestions = vfs.suggestSimilar(path)
      logger.warn('vfs_read file not found', { path, suggestions })
      const hint =
        suggestions.length > 0
          ? ` Did you mean: ${suggestions.join(', ')}?`
          : ' Use glob to discover available paths.'
      return { success: false, error: `File not found: ${path}.${hint}` }
    }
    if (
      !hasModelAttachment(result) &&
      (isOversizedReadPlaceholder(result) ||
        serializedResultSize(result) > TOOL_RESULT_MAX_INLINE_CHARS)
    ) {
      return {
        success: false,
        error:
          offset !== undefined || limit !== undefined
            ? `The requested window is still too large to return inline. Reduce limit (fewer lines per page) — e.g. read({path: "${path}", offset: ${offset ?? 0}, limit: 200}).`
            : 'Read result too large to return inline. Page it with read({path, offset, limit}), or use grep with a more specific pattern to locate the relevant section first. Avoid catch-all greps or full-file reads because they waste context window.',
      }
    }
    logger.debug('vfs_read result', { path, totalLines: result.totalLines, offset, limit })
    return {
      success: true,
      output: result,
    }
  } catch (err) {
    if (err instanceof DocsCorpusError) {
      logger.debug('vfs_read docs page rejected', { path, error: err.message })
      return { success: false, error: err.message }
    }
    logger.error('vfs_read failed', {
      path,
      error: toError(err).message,
    })
    return { success: false, error: getErrorMessage(err, 'vfs_read failed') }
  }
}
