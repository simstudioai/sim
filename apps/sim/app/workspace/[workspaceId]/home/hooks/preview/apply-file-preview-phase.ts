import type { SyntheticFilePreviewPayload } from '@/lib/copilot/request/session'
import type {
  FilePreviewSession,
  FilePreviewTargetKind,
} from '@/lib/copilot/request/session/file-preview-session-contract'

function toTargetKind(value: string | undefined): FilePreviewTargetKind | undefined {
  return value === 'new_file' || value === 'file_id' ? value : undefined
}

/**
 * Derives the next {@link FilePreviewSession} from a synthetic preview-phase
 * payload and the prior session for that tool call. Pure: identity fields prefer
 * the payload then fall back to the previous session, content accumulates by
 * delta/snapshot, and `previewVersion` advances monotonically. `now` is injected
 * so the result is deterministic; the caller supplies a single timestamp used for
 * both `updatedAt` and (on completion) `completedAt`.
 */
export function deriveFilePreviewSession(
  prev: FilePreviewSession | undefined,
  payload: SyntheticFilePreviewPayload,
  streamId: string | undefined,
  now: string
): FilePreviewSession {
  const id = payload.toolCallId

  let targetKind = prev?.targetKind
  let fileId = prev?.fileId
  let fileName = prev?.fileName ?? ''
  let operation = prev?.operation
  let edit = prev?.edit

  if (payload.previewPhase === 'file_preview_target') {
    targetKind = toTargetKind(payload.target.kind) ?? targetKind
    fileId = payload.target.fileId ?? fileId
    fileName = payload.target.fileName ?? fileName
    operation = payload.operation ?? operation
  } else if (payload.previewPhase === 'file_preview_content') {
    targetKind = toTargetKind(payload.targetKind) ?? targetKind
    fileId = payload.fileId ?? fileId
    fileName = payload.fileName ?? fileName
    operation = payload.operation ?? operation
    edit = payload.edit ?? edit
  } else if (payload.previewPhase === 'file_preview_edit_meta') {
    edit = payload.edit ?? edit
  } else if (payload.previewPhase === 'file_preview_complete') {
    fileId = payload.fileId ?? fileId
  }

  const base: FilePreviewSession = {
    schemaVersion: 1,
    id,
    streamId: streamId ?? prev?.streamId ?? '',
    toolCallId: id,
    status: prev?.status ?? 'pending',
    fileName,
    ...(fileId ? { fileId } : {}),
    ...(targetKind ? { targetKind } : {}),
    ...(operation ? { operation } : {}),
    ...(edit ? { edit } : {}),
    previewText: prev?.previewText ?? '',
    previewVersion: prev?.previewVersion ?? 0,
    updatedAt: now,
    ...(prev?.completedAt ? { completedAt: prev.completedAt } : {}),
  }

  switch (payload.previewPhase) {
    case 'file_preview_start':
    case 'file_preview_target':
    case 'file_preview_edit_meta':
      return base

    case 'file_preview_content': {
      const previewText =
        payload.contentMode === 'delta'
          ? (prev?.previewText ?? '') + payload.content
          : payload.content
      const previewVersion =
        typeof payload.previewVersion === 'number' && Number.isFinite(payload.previewVersion)
          ? payload.previewVersion
          : (prev?.previewVersion ?? 0) + 1
      return { ...base, status: 'streaming', previewText, previewVersion }
    }

    case 'file_preview_complete':
      return {
        ...base,
        status: 'complete',
        previewVersion: payload.previewVersion ?? prev?.previewVersion ?? 0,
        completedAt: now,
      }
  }
}
