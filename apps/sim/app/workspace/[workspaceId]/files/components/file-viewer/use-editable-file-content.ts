'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { toast } from '@sim/emcn'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  useUpdateWorkspaceFileContent,
  useWorkspaceFileContent,
} from '@/hooks/queries/workspace-files'
import { type SaveStatus, useAutosave } from '@/hooks/use-autosave'
import { useSmoothText } from '@/hooks/use-smooth-text'
import {
  INITIAL_TEXT_EDITOR_CONTENT_STATE,
  type SyncTextEditorContentStateOptions,
  textEditorContentReducer,
} from './text-editor-state'

/**
 * Generated-document source files (`.pptx`/`.docx`/`.pdf`/`.xlsx` builders) whose
 * editable text is the source program, not the compiled artifact. The serve route
 * returns that source only when asked for the raw representation.
 */
const GENERATED_SOURCE_FILE_TYPES = new Set([
  'text/x-pptxgenjs',
  'text/x-docxjs',
  'text/x-pdflibjs',
  'text/x-python-pdf',
  'text/x-python-xlsx',
])

/**
 * Poll cadence for the content query while the post-stream reconcile waits for a fetch showing the
 * server content advanced past the pre-stream baseline. Only active during `reconciling` — a short
 * window ending the moment a fetch advances — so the cost is a few small GETs after an agent edit.
 */
export const RECONCILING_REFETCH_INTERVAL_MS = 1500

/**
 * Cap on how long the reconcile keeps polling after a stream settles. A write that hasn't landed
 * within this window has almost certainly failed outright; past it the existing
 * `refetchOnWindowFocus: 'always'` remains the recovery path (mirrors the bounded retry on the
 * generated-doc 409 polling in `hooks/queries/workspace-files.ts`).
 */
export const RECONCILING_REFETCH_WINDOW_MS = 45_000

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
}

/**
 * Wraps the file-content reducer in editor-state semantics: reconciles fetched and
 * streamed content into a single draft, and exposes edit/save commands.
 */
function useFileContentState(options: SyncTextEditorContentStateOptions) {
  const [state, dispatch] = useReducer(textEditorContentReducer, INITIAL_TEXT_EDITOR_CONTENT_STATE)

  const prevOptionsRef = useRef<SyncTextEditorContentStateOptions | null>(null)
  const prev = prevOptionsRef.current
  if (
    prev === null ||
    prev.canReconcileToFetchedContent !== options.canReconcileToFetchedContent ||
    prev.fetchedContent !== options.fetchedContent ||
    prev.streamingContent !== options.streamingContent
  ) {
    prevOptionsRef.current = options
    dispatch({ type: 'sync-external', ...options })
  }

  const setDraftContent = useCallback((content: string) => {
    dispatch({ type: 'edit', content })
  }, [])

  const markSavedContent = useCallback((content: string) => {
    dispatch({ type: 'save-success', content })
  }, [])

  return {
    content: state.content,
    savedContent: state.savedContent,
    isInitialized: state.phase !== 'uninitialized',
    isStreamInteractionLocked: state.phase === 'streaming' || state.phase === 'reconciling',
    isReconciling: state.phase === 'reconciling',
    setDraftContent,
    markSavedContent,
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
}: UseEditableFileContentOptions): EditableFileContent {
  const onDirtyChangeRef = useRef(onDirtyChange)
  const onSaveStatusChangeRef = useRef(onSaveStatusChange)
  onDirtyChangeRef.current = onDirtyChange
  onSaveStatusChangeRef.current = onSaveStatusChange

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
    if (Date.now() - reconcilingSinceRef.current >= RECONCILING_REFETCH_WINDOW_MS) return false
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
    { refetchInterval: reconcileRefetchInterval }
  )

  /**
   * Latches once this mount has ever streamed (agent edit). A mount that streams keeps the raw fetched
   * value as its baseline for its whole life, so normalization can never perturb the stream-reconcile
   * comparisons in {@link syncTextEditorContentState}. A pure at-rest open never latches and normalizes
   * freely. Set during render (not an effect) so it is observed before the baseline is derived.
   */
  const everStreamedRef = useRef(false)
  if (streamingContent !== undefined || isAgentEditing) everStreamedRef.current = true

  // Re-derived only when the fetched content changes (never on a stream-flag flip), so the dirty
  // baseline stays stable through a post-stream reconcile.
  const baselineContent = useMemo(() => {
    if (fetchedContent === undefined || !normalizeBaseline || everStreamedRef.current) {
      return fetchedContent
    }
    return normalizeBaseline(fetchedContent)
  }, [fetchedContent, normalizeBaseline])

  const updateContent = useUpdateWorkspaceFileContent()
  const updateContentRef = useRef(updateContent)
  updateContentRef.current = updateContent

  const {
    content,
    savedContent,
    isInitialized,
    isStreamInteractionLocked: isStreamPhaseLocked,
    isReconciling,
    setDraftContent,
    markSavedContent,
  } = useFileContentState({
    canReconcileToFetchedContent: file.key.length > 0,
    fetchedContent: baselineContent,
    streamingContent,
  })
  if (isReconciling && !isReconcilingRef.current) reconcilingSinceRef.current = Date.now()
  isReconcilingRef.current = isReconciling

  const isStreamInteractionLocked = isStreamPhaseLocked || Boolean(isAgentEditing)

  // Pace the streamed reveal for DISPLAY only. The reducer above keeps the true content so
  // reconciliation, dirty tracking, and saves are never thrown off by the paced prefix. Pacing is
  // gated on the stream phase (not the agent-edit lock) and fed '' off-stream, so a user's own typing
  // is never throttled; snapOnNonAppend shows in-place rewrites/patches in full, not re-revealed.
  const pacedReveal = useSmoothText(isStreamPhaseLocked ? content : '', isStreamPhaseLocked, {
    snapOnNonAppend: true,
  })
  const displayContent = isStreamPhaseLocked ? pacedReveal : content

  const contentRef = useRef(content)
  contentRef.current = content

  const onSave = useCallback(
    async (overrideContent?: string) => {
      const next = overrideContent ?? contentRef.current
      await updateContentRef.current.mutateAsync({ workspaceId, fileId: file.id, content: next })
      markSavedContent(next)
    },
    [workspaceId, file.id, markSavedContent]
  )

  const autosaveEnabled = canEdit && isInitialized && !isStreamInteractionLocked

  const { saveStatus, saveImmediately, isDirty, discard } = useAutosave({
    content,
    savedContent,
    onSave,
    enabled: autosaveEnabled,
    draftKey: autosaveEnabled ? `${workspaceId}:${file.id}` : undefined,
    onRestoreDraft: setDraftContent,
    onDiscardCorrectionFailed: () =>
      toast.error(
        `Failed to discard "${file.name}" — the server may still have the discarded edit`
      ),
  })

  useEffect(() => {
    onDirtyChangeRef.current?.(isDirty)
  }, [isDirty])

  useEffect(() => {
    onSaveStatusChangeRef.current?.(
      saveStatus,
      saveStatus === 'error' ? saveImmediately : undefined
    )
  }, [saveStatus, saveImmediately])

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
    isDirty,
  }
}
