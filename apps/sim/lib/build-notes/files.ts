import type { WorkspaceFileVersionSource } from '@sim/db/schema'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { serializeBaseline } from '@/lib/build-notes/baseline'
import { buildNotesTemplate, MAX_BUILD_NOTES_BYTES } from '@/lib/build-notes/notes'
import { buildNotesFileName, buildNotesPath } from '@/lib/build-notes/paths'
import {
  type BuildNotesRow,
  insertBuildNotesInTx,
  setBuildNotesBaseline,
} from '@/lib/build-notes/repository'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  createOwnedWorkspaceFile,
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  updateWorkspaceFileContent,
} from '@/lib/uploads/contexts/workspace/file-manager'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/** A baseline is a whole graph; anything larger is not one this feature keeps. */
const MAX_BASELINE_BYTES = 16 * 1024 * 1024

export interface BaselineSnapshot {
  state: WorkflowState
  workflowUpdatedAt: Date
}

/** Creates the notes file with its owner row, then the baseline file of the current graph. */
export async function createBuildNotesFiles(params: {
  workspaceId: string
  workflowId: string
  workflowName: string
  userId: string
  baseline: BaselineSnapshot
}): Promise<BuildNotesRow> {
  const { workspaceId, workflowId, userId } = params
  let notes: BuildNotesRow
  try {
    ;({ owner: notes } = await createOwnedWorkspaceFile({
      context: 'build_notes',
      workspaceId,
      userId,
      content: buildNotesTemplate(params.workflowName),
      contentType: 'text/markdown',
      fileName: () => buildNotesFileName(workflowId, 'notes'),
      insertOwner: (tx, notesFileId) =>
        insertBuildNotesInTx(tx, {
          id: generateId(),
          workspaceId,
          workflowId,
          notesFileId,
          createdByUserId: userId,
        }),
    }))
  } catch (error) {
    if (getPostgresErrorCode(error) === '23505') {
      throw new OrchestrationError(
        'conflict',
        `${buildNotesPath(workflowId, 'notes')} already exists`
      )
    }
    throw error
  }
  return writeBaseline(notes, params.baseline, { userId, source: 'copilot' })
}

/**
 * Writes the baseline the notes describe. A notes row whose baseline file was never created
 * (its second commit failed) gets one now.
 */
export async function writeBaseline(
  notes: BuildNotesRow,
  baseline: BaselineSnapshot,
  author: { userId: string; source: WorkspaceFileVersionSource }
): Promise<BuildNotesRow> {
  const content = serializeBaseline(baseline.state)
  if (!notes.baselineFileId) {
    const { fileId } = await createOwnedWorkspaceFile({
      context: 'build_notes',
      workspaceId: notes.workspaceId,
      userId: author.userId,
      content,
      contentType: 'application/json',
      fileName: () => buildNotesFileName(notes.workflowId, 'baseline'),
      insertOwner: (tx, baselineFileId) =>
        setBuildNotesBaseline(
          notes.id,
          { baselineFileId, baselineWorkflowUpdatedAt: baseline.workflowUpdatedAt },
          tx
        ),
    })
    return {
      ...notes,
      baselineFileId: fileId,
      baselineWorkflowUpdatedAt: baseline.workflowUpdatedAt,
    }
  }
  await updateWorkspaceFileContent(
    notes.workspaceId,
    notes.baselineFileId,
    author.userId,
    Buffer.from(content, 'utf-8'),
    'application/json',
    {
      version: { source: author.source, authorUserId: author.userId },
      syncLiveDoc: false,
      secretProvenancePolicy: { mode: 'preserve' },
      commitOwner: (tx) =>
        setBuildNotesBaseline(
          notes.id,
          { baselineWorkflowUpdatedAt: baseline.workflowUpdatedAt },
          tx
        ),
    }
  )
  return { ...notes, baselineWorkflowUpdatedAt: baseline.workflowUpdatedAt }
}

type BuildNotesFileRecord = NonNullable<Awaited<ReturnType<typeof getWorkspaceFile>>>

/**
 * A build-notes file's text, never through the Files listing. `admit` runs on the record before
 * its bytes load; a use case returning content derived from them passes its content gate there.
 */
export async function readBuildNotesFileText(
  workspaceId: string,
  fileId: string,
  options: { maxBytes?: number; admit?: (file: BuildNotesFileRecord) => Promise<void> } = {}
): Promise<string> {
  const file = await getWorkspaceFile(workspaceId, fileId, {
    includeOwnedFiles: true,
    throwOnError: true,
  })
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  await options.admit?.(file)
  const buffer = await fetchWorkspaceFileBuffer(file, {
    maxBytes: options.maxBytes ?? MAX_BUILD_NOTES_BYTES,
  })
  return buffer.toString('utf-8')
}

export function readBaselineText(
  workspaceId: string,
  baselineFileId: string,
  admit?: (file: BuildNotesFileRecord) => Promise<void>
): Promise<string> {
  return readBuildNotesFileText(workspaceId, baselineFileId, {
    maxBytes: MAX_BASELINE_BYTES,
    ...(admit ? { admit } : {}),
  })
}
