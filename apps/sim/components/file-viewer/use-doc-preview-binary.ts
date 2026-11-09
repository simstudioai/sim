'use client'

import { useRef } from 'react'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { useWorkspaceFileBinary } from '@/hooks/queries/workspace-files'

export type DocPreviewState = 'empty' | 'loading' | 'ready' | 'stale'

export interface DocPreviewBinary {
  data: ArrayBuffer | null
  state: DocPreviewState
  error: Error | null
  dataUpdatedAt: number
}

type DocPreviewFile = Pick<WorkspaceFileRecord, 'id' | 'key' | 'size' | 'updatedAt'>

interface ResolveDocPreviewArgs {
  data: ArrayBuffer | undefined
  isPlaceholderData: boolean
  error: Error | null
  lastGood: ArrayBuffer | null
  hasCommittedContent: boolean
}

interface ResolvedDocPreview {
  data: ArrayBuffer | null
  state: DocPreviewState
  error: Error | null
  lastGood: ArrayBuffer | null
}

/**
 * Pure resolution of which binary to render and the render state, given the binary
 * query's current data, whether it is keep-previous placeholder data, the last
 * successfully fetched binary, and whether the file has committed content.
 *
 * A fresh (non-placeholder) success advances the head and renders `ready`. A
 * placeholder result (a recompile fetching a new version) or a fall back to the
 * last good binary after an error renders `stale`. Only the absence of any binary
 * yields `loading` (committed, still fetching) or `empty` (nothing committed). An
 * error is surfaced only when there is no binary to render.
 */
export function resolveDocPreviewBinary({
  data,
  isPlaceholderData,
  error,
  lastGood,
  hasCommittedContent,
}: ResolveDocPreviewArgs): ResolvedDocPreview {
  const fresh = data && !isPlaceholderData ? data : null
  const nextLastGood = fresh ?? lastGood
  const resolvedData = data ?? nextLastGood ?? null

  let state: DocPreviewState
  if (resolvedData) {
    state = fresh ? 'ready' : 'stale'
  } else {
    state = hasCommittedContent ? 'loading' : 'empty'
  }

  return {
    data: resolvedData,
    state,
    error: resolvedData ? null : error,
    lastGood: nextLastGood,
  }
}

interface DocPreviewStepArgs {
  fileChanged: boolean
  data: ArrayBuffer | undefined
  isPlaceholderData: boolean
  error: Error | null
  hasCommittedContent: boolean
  prevHasResolvedForFile: boolean
  prevLastGood: ArrayBuffer | null
}

interface DocPreviewStep {
  resolved: ResolvedDocPreview
  hasResolvedForFile: boolean
  lastGood: ArrayBuffer | null
}

/**
 * Pure per-render step for {@link useDocPreviewBinary}: folds the prior last-good
 * binary and the "has a fresh binary resolved for this file yet" flag with the
 * current query result. On a file change the prior file's last-good and resolved
 * flag are dropped, and the keep-previous placeholder (which still holds the prior
 * file's bytes) is ignored until a fresh binary resolves for the new file.
 */
export function stepDocPreviewBinary({
  fileChanged,
  data,
  isPlaceholderData,
  error,
  hasCommittedContent,
  prevHasResolvedForFile,
  prevLastGood,
}: DocPreviewStepArgs): DocPreviewStep {
  const lastGood = fileChanged ? null : prevLastGood
  const hasResolvedForFile =
    (fileChanged ? false : prevHasResolvedForFile) || (Boolean(data) && !isPlaceholderData)
  const placeholderFromPriorFile = isPlaceholderData && !hasResolvedForFile
  const resolved = resolveDocPreviewBinary({
    data: placeholderFromPriorFile ? undefined : data,
    isPlaceholderData,
    error,
    lastGood,
    hasCommittedContent,
  })
  return { resolved, hasResolvedForFile, lastGood: resolved.lastGood }
}

/**
 * Resolves the compiled binary to render for a generated or uploaded document and
 * retains the last successfully fetched binary as a fallback.
 *
 * A compiled-doc preview is a function of the file record (`size`, `updatedAt`)
 * and the binary serve route, never of the streaming tool session. While a
 * recompile is fetching (a new `updatedAt`) the previously fetched binary keeps
 * rendering; if a fetch errors after a prior success the last good binary is held
 * rather than dropping to an error. A skeleton (`empty`/`loading`) shows only when
 * no binary has ever resolved for the file. On a file switch the keep-previous
 * placeholder (which still holds the prior file's bytes) is ignored until a fresh
 * binary resolves for the new file, so one viewer never renders another file's content.
 */
export function useDocPreviewBinary(workspaceId: string, file: DocPreviewFile): DocPreviewBinary {
  const query = useWorkspaceFileBinary(workspaceId, file.id, file.key, {
    enabled: (file.size ?? 0) > 0,
    version: Number(new Date(file.updatedAt)) || file.size,
  })

  const lastGoodRef = useRef<ArrayBuffer | null>(null)
  const fileIdRef = useRef(file.id)
  const hasResolvedForFileRef = useRef(false)
  const fileChanged = fileIdRef.current !== file.id
  if (fileChanged) {
    fileIdRef.current = file.id
  }

  const step = stepDocPreviewBinary({
    fileChanged,
    data: query.data,
    isPlaceholderData: query.isPlaceholderData,
    error: (query.error as Error | null) ?? null,
    hasCommittedContent: (file.size ?? 0) > 0,
    prevHasResolvedForFile: hasResolvedForFileRef.current,
    prevLastGood: lastGoodRef.current,
  })
  hasResolvedForFileRef.current = step.hasResolvedForFile
  lastGoodRef.current = step.lastGood

  return {
    data: step.resolved.data,
    state: step.resolved.state,
    error: step.resolved.error,
    dataUpdatedAt: query.dataUpdatedAt,
  }
}
