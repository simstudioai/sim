import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { executeCopilotFileUseCase } from '@/lib/copilot/application/execute-file-use-case'
import type { ExecutionContext } from '@/lib/copilot/request/types'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'

const logger = createLogger('CopilotFilePreview')
const MAX_PREVIEW_SOURCE_BYTES = 5 * 1024 * 1024

type FilePreviewEdit = {
  strategy?: string
  search?: string
  replaceAll?: boolean
  mode?: string
  occurrence?: number
  before_anchor?: string
  after_anchor?: string
  anchor?: string
  start_anchor?: string
  end_anchor?: string
}

interface BuildFilePreviewTextOptions {
  operation: 'create' | 'append' | 'update' | 'patch'
  streamedContent: string
  existingContent?: string
  edit?: Record<string, unknown>
}

function findAnchorIndex(lines: string[], anchor: string, occurrence = 1, afterIndex = -1): number {
  const trimmed = anchor.trim()
  let count = 0
  for (let i = afterIndex + 1; i < lines.length; i++) {
    if (lines[i].trim() === trimmed) {
      count++
      if (count === occurrence) return i
    }
  }
  return -1
}

function extractPatchPreview(
  streamedContent: string,
  existingContent: string,
  edit?: Record<string, unknown>
): string | undefined {
  const strategy = typeof edit?.strategy === 'string' ? edit.strategy : undefined
  const lines = existingContent.split('\n')
  const occurrence =
    typeof edit?.occurrence === 'number' && Number.isFinite(edit.occurrence) ? edit.occurrence : 1

  if (strategy === 'search_replace') {
    const search = typeof edit?.search === 'string' ? edit.search : ''
    if (!search) return undefined
    if (edit?.replaceAll === true) {
      return existingContent.replaceAll(search, () => streamedContent)
    }
    const firstIdx = existingContent.indexOf(search)
    if (firstIdx === -1) return undefined
    return (
      existingContent.slice(0, firstIdx) +
      streamedContent +
      existingContent.slice(firstIdx + search.length)
    )
  }

  const mode = typeof edit?.mode === 'string' ? edit.mode : undefined
  if (!mode) return undefined

  if (mode === 'replace_between') {
    const beforeAnchor = typeof edit?.before_anchor === 'string' ? edit.before_anchor : undefined
    const afterAnchor = typeof edit?.after_anchor === 'string' ? edit.after_anchor : undefined
    if (!beforeAnchor || !afterAnchor) return undefined

    const beforeIdx = findAnchorIndex(lines, beforeAnchor, occurrence)
    const afterIdx = findAnchorIndex(lines, afterAnchor, occurrence, beforeIdx)
    if (beforeIdx === -1 || afterIdx === -1 || afterIdx <= beforeIdx) return undefined

    const spliced = [
      ...lines.slice(0, beforeIdx + 1),
      ...(streamedContent.length > 0 ? streamedContent.split('\n') : []),
      ...lines.slice(afterIdx),
    ]
    return spliced.join('\n')
  }

  if (mode === 'insert_after') {
    const anchor = typeof edit?.anchor === 'string' ? edit.anchor : undefined
    if (!anchor) return undefined

    const anchorIdx = findAnchorIndex(lines, anchor, occurrence)
    if (anchorIdx === -1) return undefined

    const spliced = [
      ...lines.slice(0, anchorIdx + 1),
      ...(streamedContent.length > 0 ? streamedContent.split('\n') : []),
      ...lines.slice(anchorIdx + 1),
    ]
    return spliced.join('\n')
  }

  if (mode === 'delete_between') {
    const startAnchor = typeof edit?.start_anchor === 'string' ? edit.start_anchor : undefined
    const endAnchor = typeof edit?.end_anchor === 'string' ? edit.end_anchor : undefined
    if (!startAnchor || !endAnchor) return undefined

    const startIdx = findAnchorIndex(lines, startAnchor, occurrence)
    const endIdx = findAnchorIndex(lines, endAnchor, occurrence, startIdx)
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return undefined

    const spliced = [...lines.slice(0, startIdx), ...lines.slice(endIdx)]
    return spliced.join('\n')
  }

  return undefined
}

function shouldApplyPatchPreview(streamedContent: string, edit?: Record<string, unknown>): boolean {
  const strategy = typeof edit?.strategy === 'string' ? edit.strategy : undefined
  const mode = typeof edit?.mode === 'string' ? edit.mode : undefined

  if (strategy === 'anchored' && mode === 'delete_between') {
    return true
  }

  return streamedContent.length > 0
}

function buildAppendPreview(existingContent: string, incomingContent: string): string {
  if (incomingContent.length === 0) return existingContent
  if (existingContent.length === 0) return incomingContent
  return `${existingContent}\n${incomingContent}`
}

/**
 * Reads the current UTF-8 text of a workspace file for streaming previews.
 *
 * Preview runs in the SSE loop on `prepare_file_edit` **call** events, which are
 * processed **before** the async tool executor persists {@link storeFileIntent}.
 * Loading the base here avoids a race where `apply_file_edit` `args_delta` arrives
 * before Redis holds `existingContent`, which would make append previews look like
 * full-file replacement until the intent landed.
 */
/** The base content a copilot append/patch edit is computed against, to compose the streamed preview. */
export interface WorkspaceFilePreviewBase {
  text: string
}

export async function loadWorkspaceFileTextForPreview(
  context: ExecutionContext,
  workspaceId: string,
  fileId: string
): Promise<WorkspaceFilePreviewBase | undefined> {
  try {
    const { content: buffer } = await executeCopilotFileUseCase(
      context,
      readWorkspaceFileContent,
      {
        fileId,
        assertedWorkspaceId: workspaceId,
        maxBytes: MAX_PREVIEW_SOURCE_BYTES,
      },
      { fileId }
    )
    return {
      text: buffer.toString('utf-8'),
    }
  } catch (error) {
    logger.warn('Failed to load workspace file text for preview', {
      workspaceId,
      fileId,
      error: toError(error).message,
    })
    return undefined
  }
}

export function buildFilePreviewText({
  operation,
  streamedContent,
  existingContent,
  edit,
}: BuildFilePreviewTextOptions): string | undefined {
  if (operation === 'update') {
    return streamedContent
  }

  if (operation === 'create') {
    return streamedContent
  }

  if (operation === 'append') {
    // Fail closed (like `patch`/`update` below) when the base file content has not loaded yet: a base-less
    // `append` preview is just the streamed fragment, and a collaborative editor applying it as the full
    // body would reconcile the seeded doc down to that fragment (a wipe). Skipping the preview until the
    // base is available costs only a brief render delay; the final durable `apply_file_edit` write is
    // authoritative. An empty file has `existingContent === ''` (defined), so it is unaffected.
    if (existingContent === undefined) {
      return undefined
    }
    return buildAppendPreview(existingContent, streamedContent)
  }

  if (existingContent === undefined) {
    return undefined
  }

  if (!shouldApplyPatchPreview(streamedContent, edit)) {
    return undefined
  }

  return extractPatchPreview(streamedContent, existingContent, edit)
}
