'use client'

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { toast } from '@sim/emcn'
import { isApiClientError } from '@/lib/api/client/errors'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { GENERATED_DOCUMENT_SOURCE_TYPES } from '@/lib/uploads/utils/file-utils'
import {
  INITIAL_TEXT_EDITOR_CONTENT_STATE,
  type SyncTextEditorContentStateOptions,
  textEditorContentReducer,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/text-editor-state'
import {
  useReloadWorkspaceFileContent,
  useUpdateWorkspaceFileContent,
  useWorkspaceFileContent,
} from '@/hooks/queries/workspace-files'
import { type SaveStatus, useAutosave } from '@/hooks/use-autosave'
import { useSmoothText } from '@/hooks/use-smooth-text'

/**
 * Generated-document source files (`.pptx`/`.docx`/`.pdf`/`.xlsx` builders) whose
 * editable text is the source program, not the compiled artifact. The serve route
 * returns that source only when asked for the raw representation.
 */
const GENERATED_SOURCE_FILE_TYPES = GENERATED_DOCUMENT_SOURCE_TYPES

/**
 * Poll cadence for the content query while the post-stream reconcile waits for a fetch showing the
 * server content advanced past the pre-stream baseline. Only active during `reconciling` — a short
 * window ending the moment a fetch advances — so the cost is a few small GETs after an agent edit.
 */
export const RECONCILING_REFETCH_INTERVAL_MS = 1500

/**
 * How long the reconcile polls at the fast cadence after a stream settles. A write that hasn't
 * landed within this window has almost certainly failed or is badly delayed, so polling degrades
 * to {@link RECONCILING_REFETCH_SLOW_INTERVAL_MS} — never stopping outright, so the editor can't
 * end up locked read-only with no automatic recovery (react-query pauses interval refetches in
 * background tabs by default, so a wedged doc left open does not poll unattended).
 */
export const RECONCILING_REFETCH_WINDOW_MS = 45_000

/** Slow-poll cadence once the fast window has elapsed without the server content advancing. */
export const RECONCILING_REFETCH_SLOW_INTERVAL_MS = 15_000

interface UseEditableFileContentOptions {
  file: WorkspaceFileRecord
  workspaceId: string
  canEdit: boolean
  streamingContent?: string
  isAgentEditing?: boolean
  onDirtyChange?: (isDirty: boolean) => void
  /** `retry` is this instance's own `saveImmediately`, passed alongside an `'error'` status so a caller-side retry never depends on a shared, remount-able ref. */
  onSaveStatusChange?: (status: SaveStatus, retry?: () => Promise<void>) => void
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>
  /** Bridges an imperative "discard the current draft" command up to the caller, mirroring `saveRef`. */
  discardRef?: React.MutableRefObject<(() => void) | null>
  /**
   * Optional transform applied to the fetched content before it becomes the editor's baseline. A
   * surface whose editor re-serializes its content to a canonical form (the rich markdown editor)
   * passes its normalizer so an already-canonical file never reads as dirty on open. Applied only to
   * the at-rest baseline, never while an agent stream is in flight. Stable reference required.
   */
  normalizeBaseline?: (raw: string) => string
  /**
   * Extra gate on autosave (and draft persistence). When `false`, saving is
   * suppressed even when otherwise eligible — the collaborative editor uses it to
   * hold saves until the shared document is synced AND seeded, so an empty or
   * partially-synced doc can never overwrite the real file. Defaults to `true`.
   */
  canAutosave?: boolean
}

interface EditableFileContent {
  /** The current draft markdown/text, reflecting both user edits and streamed output. */
  content: string
  /** Replace the draft content from an editing surface (no-op while streaming). */
  setDraftContent: (content: string) => void
  /** True once the initial fetched content has been reconciled into editor state. */
  isInitialized: boolean
  /** True while agent output is streaming in — surfaces should render read-only. */
  isStreamInteractionLocked: boolean
  /** True when the initial content fetch is in flight and nothing is renderable yet. */
  isContentLoading: boolean
  /** True when the initial content fetch failed before any content was shown. */
  hasContentError: boolean
  saveStatus: SaveStatus
  saveImmediately: () => Promise<void>
  isDirty: boolean
  hasConflict: boolean
  isReloading: boolean
  reloadLatestContent: () => Promise<void>
  downloadDraft: () => void
  acceptedBaselineContent?: string
}

/**
 * Wraps the file-content reducer in editor-state semantics: reconciles fetched and
 * streamed content into a single draft, and exposes edit/save commands.
 */
function useFileContentState(options: SyncTextEditorContentStateOptions) {
  const [state, dispatch] = useReducer(textEditorContentReducer, INITIAL_TEXT_EDITOR_CONTENT_STATE)

  const [prev, setPrev] = useState<SyncTextEditorContentStateOptions | null>(null)
  if (
    prev === null ||
    prev.canReconcileToFetchedContent !== options.canReconcileToFetchedContent ||
    prev.fetchedContent !== options.fetchedContent ||
    prev.fetchedVersion !== options.fetchedVersion ||
    prev.streamingContent !== options.streamingContent
  ) {
    setPrev(options)
    dispatch({ type: 'sync-external', ...options })
  }

  const setDraftContent = useCallback((content: string) => {
    dispatch({ type: 'edit', content })
  }, [])

  const markSavedContent = useCallback((content: string, version?: string) => {
    dispatch({ type: 'save-success', content, version })
  }, [])

  const markConflict = useCallback(() => dispatch({ type: 'save-conflict' }), [])
  const restoreConflictingDraft = useCallback(
    (content: string) => dispatch({ type: 'restore-conflicting-draft', content }),
    []
  )
  const acceptReload = useCallback(
    (content: string, version: string) => dispatch({ type: 'reload', content, version }),
    []
  )

  return {
    content: state.content,
    savedContent: state.savedContent,
    isInitialized: state.phase !== 'uninitialized',
    isStreamInteractionLocked: state.phase === 'streaming' || state.phase === 'reconciling',
    isReconciling: state.phase === 'reconciling',
    setDraftContent,
    markSavedContent,
    savedVersion: state.savedVersion,
    hasConflict: Boolean(state.conflict),
    acceptedBaselineContent: state.acceptedBaselineContent,
    markConflict,
    restoreConflictingDraft,
    acceptReload,
  }
}

/**
 * The editing engine shared by every text-editable file surface (Monaco code
 * editor, rich markdown editor). It owns content loading, the fetched/streamed/edited
 * reconciliation, debounced autosave, and the dirty/save-status/`saveRef` prop bridge —
 * leaving each surface responsible only for rendering and capturing edits.
 */
export function useEditableFileContent({
  file,
  workspaceId,
  canEdit,
  streamingContent,
  isAgentEditing,
  onDirtyChange,
  onSaveStatusChange,
  saveRef,
  discardRef,
  normalizeBaseline,
  canAutosave = true,
}: UseEditableFileContentOptions): EditableFileContent {
  const onDirtyChangeRef = useRef(onDirtyChange)
  const onSaveStatusChangeRef = useRef(onSaveStatusChange)

  /**
   * Mirrors the reducer's `reconciling` phase (assigned below the reducer hook; read here through a
   * stable function that react-query re-evaluates after every fetch and options pass, so polling
   * starts and stops with the phase, no extra re-render required). While reconciling — the stream
   * ended but no fetch has shown the server content advancing past the pre-stream baseline yet —
   * the content query polls. The reconcile's exit is data-driven and this is its only retry: a
   * single refetch that races the agent's write (or an invalidation that never reaches this
   * surface) would otherwise leave the editor read-only until a window refocus or a full reload.
   */
  const isReconcilingRef = useRef(false)
  const reconcilingSinceRef = useRef(0)
  const reconcileRefetchInterval = useCallback(() => {
    if (!isReconcilingRef.current) return false
    if (Date.now() - reconcilingSinceRef.current >= RECONCILING_REFETCH_WINDOW_MS) {
      return RECONCILING_REFETCH_SLOW_INTERVAL_MS
    }
    return RECONCILING_REFETCH_INTERVAL_MS
  }, [])

  const {
    data: fetchedContent,
    isLoading,
    error,
  } = useWorkspaceFileContent(
    workspaceId,
    file.id,
    file.key,
    GENERATED_SOURCE_FILE_TYPES.has(file.type),
    {
      refetchInterval: reconcileRefetchInterval,
      // `canAutosave: false` on this surface means a server-side owner holds durability — the
      // collaborative relay, which projects the live document to markdown itself and merges
      // external writes INTO that document. There is nothing a focus refetch of the durable bytes
      // can teach the editor that the shared document does not already have; all it does is
      // re-read a storage key the relay's last save has already rotated away from.
      refetchOnWindowFocus: canAutosave,
    }
  )

  /** A stream-only transition retains the accepted representation; subsequent fetched snapshots stay raw for reconciliation. */
  const isStreamObserved = streamingContent !== undefined || Boolean(isAgentEditing)
  const [baseline, setBaseline] = useState(() => ({
    source: fetchedContent,
    normalizer: normalizeBaseline,
    everStreamed: isStreamObserved,
    content:
      fetchedContent !== undefined && normalizeBaseline && !isStreamObserved
        ? normalizeBaseline(fetchedContent)
        : fetchedContent,
  }))
  const everStreamed = baseline.everStreamed || isStreamObserved
  const sourceChanged =
    baseline.source !== fetchedContent || baseline.normalizer !== normalizeBaseline
  if (sourceChanged || everStreamed !== baseline.everStreamed) {
    setBaseline({
      source: fetchedContent,
      normalizer: normalizeBaseline,
      everStreamed,
      content: sourceChanged
        ? fetchedContent !== undefined && normalizeBaseline && !everStreamed
          ? normalizeBaseline(fetchedContent)
          : fetchedContent
        : baseline.content,
    })
  }
  const baselineContent = baseline.content
  const everStreamedRef = useRef(everStreamed)

  const updateContent = useUpdateWorkspaceFileContent()
  const reloadContent = useReloadWorkspaceFileContent()
  const updateContentRef = useRef(updateContent)

  const {
    content,
    savedContent,
    isInitialized,
    isStreamInteractionLocked: isStreamPhaseLocked,
    isReconciling,
    setDraftContent,
    markSavedContent,
    savedVersion,
    hasConflict,
    acceptedBaselineContent,
    markConflict,
    restoreConflictingDraft,
    acceptReload,
  } = useFileContentState({
    canReconcileToFetchedContent: file.key.length > 0,
    fetchedContent: baselineContent,
    fetchedVersion:
      fetchedContent !== undefined && file.contentUpdatedAt
        ? new Date(file.contentUpdatedAt).toISOString()
        : undefined,
    streamingContent,
  })
  const isAgentStreamActive = streamingContent !== undefined || Boolean(isAgentEditing)
  const streamActiveRef = useRef(isAgentStreamActive)
  const isStreamInteractionLocked =
    isStreamPhaseLocked || Boolean(isAgentEditing) || (hasConflict && isAgentStreamActive)

  // Pace the streamed reveal for DISPLAY only. The reducer above keeps the true content so
  // reconciliation, dirty tracking, and saves are never thrown off by the paced prefix. Pacing is
  // gated on the stream phase (not the agent-edit lock) and fed '' off-stream, so a user's own typing
  // is never throttled; snapOnNonAppend shows in-place rewrites/patches in full, not re-revealed.
  const pacedReveal = useSmoothText(isStreamPhaseLocked ? content : '', isStreamPhaseLocked, {
    snapOnNonAppend: true,
  })
  const displayContent = isStreamPhaseLocked ? pacedReveal : content

  const contentRef = useRef(content)
  const saveVersionRef = useRef(savedVersion)
  const conflictRef = useRef(hasConflict)

  /** Publish one committed draft/baseline to asynchronous saves, reloads, and query polling. */
  useLayoutEffect(() => {
    if (isReconciling && !isReconcilingRef.current) reconcilingSinceRef.current = Date.now()
    isReconcilingRef.current = isReconciling
    everStreamedRef.current = everStreamed
    onDirtyChangeRef.current = onDirtyChange
    onSaveStatusChangeRef.current = onSaveStatusChange
    updateContentRef.current = updateContent
    streamActiveRef.current = isAgentStreamActive
    contentRef.current = content
    saveVersionRef.current = savedVersion
    conflictRef.current = hasConflict
  })

  const onSave = useCallback(
    async (overrideContent?: string) => {
      const next = overrideContent ?? contentRef.current
      const expectedUpdatedAt = saveVersionRef.current
      if (conflictRef.current) throw new Error('Reload the latest file before saving this draft')
      if (!expectedUpdatedAt) {
        conflictRef.current = true
        markConflict()
        throw new Error('The file version is unavailable; reload before saving')
      }
      try {
        const result = await updateContentRef.current.mutateAsync({
          workspaceId,
          fileId: file.id,
          content: next,
          expectedUpdatedAt,
        })
        const version = result.file.contentUpdatedAt
        if (!version) {
          conflictRef.current = true
          markConflict()
          throw new Error('Saved file version is unavailable; reload before continuing')
        }
        const acknowledgedVersion = new Date(version).toISOString()
        if (
          !saveVersionRef.current ||
          Date.parse(acknowledgedVersion) >= Date.parse(saveVersionRef.current)
        ) {
          saveVersionRef.current = acknowledgedVersion
        }
        markSavedContent(next, acknowledgedVersion)
      } catch (error) {
        if (
          isApiClientError(error) &&
          error.status === 409 &&
          saveVersionRef.current === expectedUpdatedAt
        ) {
          conflictRef.current = true
          markConflict()
        }
        throw error
      }
    },
    [workspaceId, file.id, markSavedContent, markConflict]
  )

  const autosaveEnabled =
    canEdit &&
    isInitialized &&
    canAutosave &&
    (!isStreamInteractionLocked ||
      hasConflict ||
      (!isStreamPhaseLocked && content !== savedContent))

  const {
    saveStatus: autosaveStatus,
    saveImmediately,
    isDirty,
    discard,
  } = useAutosave({
    content,
    savedContent,
    onSave,
    enabled: autosaveEnabled,
    pauseSaving: hasConflict || isStreamInteractionLocked,
    draftKey: autosaveEnabled ? `${workspaceId}:${file.id}` : undefined,
    onRestoreDraft: setDraftContent,
    onRestoreConflictingDraft: restoreConflictingDraft,
    onDiscardCorrectionFailed: () =>
      toast.error(
        `Failed to discard "${file.name}" — the server may still have the discarded edit`
      ),
  })
  const saveStatus = hasConflict ? 'error' : autosaveStatus

  const reloadLatestContent = useCallback(async () => {
    if (streamActiveRef.current)
      throw new Error('Wait for the agent edit to finish before reloading')
    const draftAtStart = contentRef.current
    const result = await reloadContent.mutateAsync({
      workspaceId,
      fileId: file.id,
      raw: GENERATED_SOURCE_FILE_TYPES.has(file.type),
    })
    if (streamActiveRef.current)
      throw new Error('An agent edit started while reloading. Retry after it finishes.')
    if (contentRef.current !== draftAtStart)
      throw new Error('Your draft changed while reloading. Download it or retry reload.')
    if (!result.file.contentUpdatedAt) throw new Error('The latest file version is unavailable')
    const latestContent =
      normalizeBaseline && !everStreamedRef.current
        ? normalizeBaseline(result.content)
        : result.content
    discard({ correctInFlightSave: false })
    const version = new Date(result.file.contentUpdatedAt).toISOString()
    saveVersionRef.current = version
    conflictRef.current = false
    acceptReload(latestContent, version)
  }, [
    reloadContent.mutateAsync,
    workspaceId,
    file.id,
    file.type,
    normalizeBaseline,
    discard,
    acceptReload,
  ])

  const downloadDraft = useCallback(() => {
    const url = URL.createObjectURL(
      new Blob([contentRef.current], { type: 'text/plain;charset=utf-8' })
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${file.name}.local-draft.txt`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }, [file.name])

  // When the client can't autosave it isn't the durability owner: the collaborative editor holds
  // `canAutosave` permanently false because the relay persists the doc server-side (debounced + on
  // last-disconnect), so `savedContent` never advances and raw `isDirty` would latch true after any
  // local OR remote keystroke — surfacing a spurious "Unsaved changes" navigation prompt whose
  // "Discard" discards nothing real. With nothing the user can save, there is nothing to warn about.
  const isDirtyForCaller = canAutosave && isDirty

  useEffect(() => {
    onDirtyChangeRef.current?.(isDirtyForCaller)
  }, [isDirtyForCaller])

  useEffect(() => {
    onSaveStatusChangeRef.current?.(
      saveStatus,
      saveStatus === 'error' && !hasConflict ? saveImmediately : undefined
    )
  }, [saveStatus, saveImmediately, hasConflict])

  useEffect(() => {
    if (!saveRef) return
    saveRef.current = saveImmediately
    return () => {
      if (saveRef.current === saveImmediately) {
        saveRef.current = null
      }
    }
  }, [saveImmediately, saveRef])

  const discardChanges = useCallback(() => {
    discard()
    setDraftContent(savedContent)
  }, [discard, setDraftContent, savedContent])

  useEffect(() => {
    if (!discardRef) return
    discardRef.current = discardChanges
    return () => {
      if (discardRef.current === discardChanges) {
        discardRef.current = null
      }
    }
  }, [discardChanges, discardRef])

  return {
    content: displayContent,
    setDraftContent,
    isInitialized,
    isStreamInteractionLocked,
    // `!isInitialized` mirrors `hasContentError`: once any content (fetched OR streamed) has
    // initialized the editor, never fall back to the loading frame. A stream that finishes before the
    // initial file fetch resolves flips `streamingContent` to undefined while `isLoading` is still
    // true — without this guard that would unmount the settled editor (losing the read-only→editable
    // hand-off, scroll, and parsed doc) until the fetch lands.
    isContentLoading: streamingContent === undefined && isLoading && !isInitialized,
    hasContentError: streamingContent === undefined && Boolean(error) && !isInitialized,
    saveStatus,
    saveImmediately,
    isDirty: isDirtyForCaller,
    hasConflict,
    isReloading: reloadContent.isPending,
    reloadLatestContent,
    downloadDraft,
    acceptedBaselineContent,
  }
}
