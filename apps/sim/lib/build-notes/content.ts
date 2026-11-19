import { isUtf8 } from 'node:buffer'
import { MAX_BUILD_NOTES_BYTES } from '@/lib/build-notes/notes'
import { buildNotesPath } from '@/lib/build-notes/paths'
import { getLiveBuildNotesByFileId } from '@/lib/build-notes/repository'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/**
 * Checks a write to a build-notes file. The notes are the agent's to edit; the baseline is the
 * graph Sim last recorded, so only Sim writes it.
 */
export async function prepareBuildNotesWrite(input: {
  fileId: string
  workspaceId: string
  content: Buffer
}): Promise<undefined> {
  const notes = await getLiveBuildNotesByFileId(input.fileId)
  if (!notes) throw new OrchestrationError('not_found', 'File not found')
  if (notes.baselineFileId === input.fileId) {
    throw new OrchestrationError(
      'forbidden',
      `${buildNotesPath(notes.workflowId, 'baseline')} is kept by Sim. After reconciling edits made outside the agent, run build-notes rebase.`
    )
  }
  if (input.content.length > MAX_BUILD_NOTES_BYTES) {
    throw new OrchestrationError(
      'payload_too_large',
      `Build notes can be at most ${MAX_BUILD_NOTES_BYTES / 1024}KB`
    )
  }
  if (!isUtf8(input.content)) {
    throw new OrchestrationError('validation', 'Build notes must be UTF-8 text')
  }
  return undefined
}
