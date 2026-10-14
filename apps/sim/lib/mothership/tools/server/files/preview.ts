import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { observeContentOutsideModel } from '@/lib/core/application'
import { executeCopilotFileUseCase } from '@/lib/mothership/application/execute-file-use-case'
import type { ExecutionContext } from '@/lib/mothership/request/types'
import { toAnchoredContentEdit } from '@/lib/mothership/tools/server/files/anchored-edit'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'
import { applyWorkspaceFileContentEdit, EditContentError } from '@/lib/workspace-files/edit-content'

const logger = createLogger('CopilotFilePreview')
const MAX_PREVIEW_SOURCE_BYTES = 5 * 1024 * 1024

interface BuildFilePreviewTextOptions {
  operation: 'create' | 'append' | 'update' | 'patch'
  streamedContent: string
  existingContent?: string
  edit?: Record<string, unknown>
}

function extractPatchPreview(
  streamedContent: string,
  existingContent: string,
  edit?: Record<string, unknown>
): string | undefined {
  const strategy = typeof edit?.strategy === 'string' ? edit.strategy : undefined

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

  if (strategy !== 'anchored' || !edit) return undefined
  const anchored = toAnchoredContentEdit(edit, streamedContent)
  if ('error' in anchored) return undefined
  try {
    return applyWorkspaceFileContentEdit(existingContent, anchored.edit)
  } catch (error) {
    if (error instanceof EditContentError) return undefined
    throw error
  }
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
    /** The preview streams to the user's own editor, never to the model. */
    const { content: buffer } = await observeContentOutsideModel(() =>
      executeCopilotFileUseCase(
        context,
        readWorkspaceFileContent,
        {
          fileId,
          assertedWorkspaceId: workspaceId,
          maxBytes: MAX_PREVIEW_SOURCE_BYTES,
        },
        { fileId }
      )
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
