'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { del, get, set } from 'idb-keyval'

const logger = createLogger('Autosave')

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface LocalDraft {
  content: string
  savedContent: string
}

const LOCAL_DRAFT_DELAY_MS = 400
const MIN_SAVING_DISPLAY_MS = 600

function localDraftDbKey(draftKey: string) {
  return `autosave-draft:${draftKey}`
}

const draftOpQueues = new Map<string, Promise<unknown>>()

/** Serializes IndexedDB reads/writes for a given draft key across every `useAutosave` instance (including one that already unmounted), so a late write from a just-unmounted instance can't land after a newly-mounted instance's delete or recovery read. */
function enqueueDraftOp<T>(key: string, op: () => Promise<T>): Promise<T> {
  const prev = draftOpQueues.get(key) ?? Promise.resolve()
  const result = prev.then(op, op)
  const settled = result.catch(() => {})
  draftOpQueues.set(key, settled)
  void settled.then(() => {
    if (draftOpQueues.get(key) === settled) draftOpQueues.delete(key)
  })
  return result
}

interface UseAutosaveOptions {
  content: string
  savedContent: string
  /** `overrideContent`, when passed, is what `discard()`'s corrective save pushes — the reverted baseline captured at discard time, not whatever the ambient content ref reads by the time the in-flight save it's correcting for has settled. */
  onSave: (overrideContent?: string) => Promise<void>
  delay?: number
  enabled?: boolean
  /** Suspends network writes without disabling local draft persistence or recovery. */
  pauseSaving?: boolean
  /**
   * Uniquely identifies the document being edited (e.g. a file id). When set, the draft is
   * mirrored into IndexedDB on a short debounce, independent of the network save, and recovered
   * via `onRestoreDraft` on mount if newer than `savedContent`.
   */
  draftKey?: string
  onRestoreDraft?: (content: string) => void
  /** Retains a recovered draft when its original server baseline is no longer current. */
  onRestoreConflictingDraft?: (content: string) => void
  /** Called if `discard()`'s corrective save fails — the only way that failure can surface, since it happens after the component may already have unmounted. */
  onDiscardCorrectionFailed?: () => void
}

interface UseAutosaveReturn {
  saveStatus: SaveStatus
  saveImmediately: () => Promise<void>
  isDirty: boolean
  /** Abandons the current draft: blocks any save/local-draft write not yet started, clears the local draft immediately, and corrects the server if a save already in flight lands afterward. */
  discard: (options?: { correctInFlightSave?: boolean }) => void
}

/**
 * Shared autosave hook that debounces content changes and persists them automatically.
 * Keeps Cmd+S / Save button working via `saveImmediately`, and flushes on unmount
 * so edits aren't lost when navigating away.
 */
export function useAutosave({
  content,
  savedContent,
  onSave,
  delay = 1500,
  enabled = true,
  pauseSaving = false,
  draftKey,
  onRestoreDraft,
  onRestoreConflictingDraft,
  onDiscardCorrectionFailed,
}: UseAutosaveOptions): UseAutosaveReturn {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const displayTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const savingRef = useRef(false)
  const savingStartRef = useRef(0)
  const saveGenerationRef = useRef(0)
  const inFlightRef = useRef<Promise<void> | null>(null)
  const unmountedRef = useRef(false)
  const onSaveRef = useRef(onSave)
  const enabledRef = useRef(enabled)
  const pauseSavingRef = useRef(pauseSaving)
  const savedContentRef = useRef(savedContent)
  const contentRef = useRef(content)

  const effectiveDraftKey = enabled ? draftKey : undefined
  const draftKeyRef = useRef(effectiveDraftKey)
  const onRestoreDraftRef = useRef(onRestoreDraft)
  const onRestoreConflictingDraftRef = useRef(onRestoreConflictingDraft)
  const onDiscardCorrectionFailedRef = useRef(onDiscardCorrectionFailed)

  const localDraftTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const lastPersistedContentRef = useRef<string | null>(null)

  const discardedRef = useRef(false)
  const discardTargetRef = useRef<string | null>(null)
  const failedCorrectionTargetRef = useRef<string | null>(null)
  /** Disabling autosave during a stream must not count as switching documents. */
  const documentKeyRef = useRef(draftKey)

  /** Timers, recovery, and explicit saves must never observe a suspended or abandoned render. */
  useLayoutEffect(() => {
    if (
      documentKeyRef.current !== draftKey ||
      (discardedRef.current && content !== discardTargetRef.current)
    ) {
      discardedRef.current = false
      failedCorrectionTargetRef.current = null
    }
    documentKeyRef.current = draftKey
    onSaveRef.current = onSave
    enabledRef.current = enabled
    pauseSavingRef.current = pauseSaving
    savedContentRef.current = savedContent
    contentRef.current = content
    draftKeyRef.current = effectiveDraftKey
    onRestoreDraftRef.current = onRestoreDraft
    onRestoreConflictingDraftRef.current = onRestoreConflictingDraft
    onDiscardCorrectionFailedRef.current = onDiscardCorrectionFailed
  })

  const isDirty = content !== savedContent

  const persistLocalDraft = useCallback(() => {
    const key = draftKeyRef.current
    if (discardedRef.current || !key || contentRef.current === savedContentRef.current) return
    if (contentRef.current === lastPersistedContentRef.current) return
    const content = contentRef.current
    const savedContentSnapshot = savedContentRef.current
    void enqueueDraftOp(key, () =>
      set(localDraftDbKey(key), {
        content,
        savedContent: savedContentSnapshot,
      } satisfies LocalDraft)
    )
      .then(() => {
        lastPersistedContentRef.current = content
      })
      .catch((error) => {
        logger.warn('IndexedDB draft write failed', { key, error })
      })
  }, [])

  const clearLocalDraft = useCallback(() => {
    const key = draftKeyRef.current
    lastPersistedContentRef.current = null
    if (!key) return
    void enqueueDraftOp(key, () => del(localDraftDbKey(key))).catch((error) => {
      logger.warn('IndexedDB draft delete failed', { key, error })
    })
  }, [])

  const save = useCallback(async () => {
    if (
      discardedRef.current ||
      !enabledRef.current ||
      pauseSavingRef.current ||
      savingRef.current ||
      contentRef.current === savedContentRef.current
    ) {
      return
    }
    savingRef.current = true
    const generation = saveGenerationRef.current
    savingStartRef.current = Date.now()
    if (!unmountedRef.current) setSaveStatus('saving')
    const run = (async () => {
      let nextStatus: SaveStatus = 'saved'
      try {
        await onSaveRef.current()
      } catch {
        nextStatus = 'error'
      } finally {
        inFlightRef.current = null
        if (generation !== saveGenerationRef.current) {
          savingRef.current = false
          if (!unmountedRef.current && contentRef.current !== savedContentRef.current) save()
        } else if (unmountedRef.current) {
          savingRef.current = false
        } else {
          const elapsed = Date.now() - savingStartRef.current
          const remaining = Math.max(0, MIN_SAVING_DISPLAY_MS - elapsed)
          displayTimerRef.current = setTimeout(() => {
            // While discarded, status is owned by discard()'s corrective save instead — this
            // save's outcome no longer reflects what the user is looking at, and letting the
            // idle-timer fire anyway would prematurely clear a status the correction just set.
            if (!discardedRef.current) {
              setSaveStatus(nextStatus)
              clearTimeout(idleTimerRef.current)
              idleTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
            }
            if (inFlightRef.current) return
            savingRef.current = false
            if (nextStatus !== 'error' && contentRef.current !== savedContentRef.current) {
              save()
            }
          }, remaining)
        }
      }
    })()
    inFlightRef.current = run
    await run
  }, [])

  useEffect(() => {
    if (!enabled || pauseSaving || !isDirty || savingRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(save, delay)
    return () => clearTimeout(timerRef.current)
  }, [content, enabled, pauseSaving, isDirty, delay, save])

  useEffect(() => {
    // Reset on every (re)mount, not only set on unmount: React strict mode runs effects
    // mount → cleanup → mount, so without this the flag would stay `true` after the dev
    // double-invoke and permanently suppress the "saving"/"saved" status updates below.
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      clearTimeout(timerRef.current)
      clearTimeout(idleTimerRef.current)
      clearTimeout(displayTimerRef.current)
      clearTimeout(localDraftTimerRef.current)
      persistLocalDraft()
      if (
        discardedRef.current ||
        !enabledRef.current ||
        pauseSavingRef.current ||
        contentRef.current === savedContentRef.current
      ) {
        return
      }
      // Flush the latest content on unmount, but chain it AFTER any in-flight save rather than
      // firing a concurrent PUT: the in-flight save captured an older snapshot, so writing the
      // latest sequentially (last) prevents an out-of-order completion from clobbering it.
      void (async () => {
        await inFlightRef.current
        if (!discardedRef.current && !pauseSavingRef.current) {
          await onSaveRef.current().then(clearLocalDraft, () => {})
        }
      })()
    }
  }, [clearLocalDraft, persistLocalDraft])

  const wasDirtyRef = useRef(isDirty)

  useEffect(() => {
    if (effectiveDraftKey && !isDirty && wasDirtyRef.current) clearLocalDraft()
    wasDirtyRef.current = isDirty
  }, [effectiveDraftKey, isDirty, clearLocalDraft])

  useEffect(() => {
    if (!effectiveDraftKey || !isDirty) return
    clearTimeout(localDraftTimerRef.current)
    localDraftTimerRef.current = setTimeout(persistLocalDraft, LOCAL_DRAFT_DELAY_MS)
    return () => clearTimeout(localDraftTimerRef.current)
  }, [content, effectiveDraftKey, isDirty, persistLocalDraft])

  useEffect(() => {
    if (!effectiveDraftKey) return
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') persistLocalDraft()
    }
    window.addEventListener('pagehide', persistLocalDraft)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('pagehide', persistLocalDraft)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [effectiveDraftKey, persistLocalDraft])

  const recoveredForKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!effectiveDraftKey || recoveredForKeyRef.current === effectiveDraftKey) return
    let cancelled = false
    void enqueueDraftOp(effectiveDraftKey, () =>
      get<LocalDraft>(localDraftDbKey(effectiveDraftKey))
    )
      .then((draft) => {
        if (cancelled) return
        recoveredForKeyRef.current = effectiveDraftKey
        if (!draft) return
        if (draft.savedContent !== savedContentRef.current) {
          if (onRestoreConflictingDraftRef.current) {
            if (contentRef.current === savedContentRef.current)
              onRestoreConflictingDraftRef.current(draft.content)
            return
          }
          clearLocalDraft()
          return
        }
        if (draft.content === draft.savedContent) return
        if (contentRef.current !== savedContentRef.current) return
        onRestoreDraftRef.current?.(draft.content)
      })
      .catch((error) => {
        logger.warn('IndexedDB draft read failed', { draftKey: effectiveDraftKey, error })
      })
    return () => {
      cancelled = true
    }
  }, [effectiveDraftKey, clearLocalDraft])

  /** Pushes `target` (the reverted baseline) to the server. Used both by `discard()`'s initial correction and by `saveImmediately`'s retry of a correction that previously failed — content already equals `target` in both cases, so this bypasses `save()`'s dirty-check entirely rather than special-casing it there. */
  const runCorrection = useCallback(
    (target: string) => {
      savingRef.current = true
      const correction = pauseSavingRef.current
        ? Promise.reject(new Error('Saving is paused; the discarded edit could not be reverted'))
        : onSaveRef.current(target)
      const correctionRun = correction
        .then(
          () => {
            failedCorrectionTargetRef.current = null
            // Only ours to set if nothing has since un-suppressed discard (a newer edit) — that
            // flow owns status once it takes over.
            if (!unmountedRef.current && discardedRef.current) setSaveStatus('idle')
          },
          (error) => {
            failedCorrectionTargetRef.current = target
            logger.warn('Corrective save after discard failed', { error })
            onDiscardCorrectionFailedRef.current?.()
            if (!unmountedRef.current && discardedRef.current) setSaveStatus('error')
          }
        )
        .finally(() => {
          savingRef.current = false
          inFlightRef.current = null
          // A newer edit made while the correction was in flight bailed out of the debounce
          // effect (savingRef was held) and never got rescheduled — pick it up now that the
          // mutex is free. This also gives that edit's own save cycle ownership of saveStatus,
          // covering a correction that failed after a newer edit already un-suppressed discard.
          if (!unmountedRef.current && contentRef.current !== savedContentRef.current) save()
        })
      inFlightRef.current = correctionRun
      return correctionRun
    },
    [save]
  )

  const saveImmediately = useCallback(async () => {
    clearTimeout(timerRef.current)
    // Retrying after a failed correction: content already equals savedContent (that's what
    // discard reverted to), so save()'s own dirty-check would treat this as a no-op and the
    // error's retry button would silently do nothing.
    if (failedCorrectionTargetRef.current !== null) {
      await runCorrection(failedCorrectionTargetRef.current)
      return
    }
    await save()
  }, [save, runCorrection])

  const discard = useCallback(
    (options?: { correctInFlightSave?: boolean }) => {
      discardedRef.current = true
      discardTargetRef.current = savedContentRef.current
      failedCorrectionTargetRef.current = null
      clearTimeout(timerRef.current)
      clearTimeout(localDraftTimerRef.current)
      clearLocalDraft()
      const pendingSave = inFlightRef.current
      if (options?.correctInFlightSave === false) {
        saveGenerationRef.current += 1
        clearTimeout(displayTimerRef.current)
        clearTimeout(idleTimerRef.current)
        if (!pendingSave) savingRef.current = false
      }
      if (!pendingSave || options?.correctInFlightSave === false) {
        if (!unmountedRef.current) setSaveStatus('idle')
        return
      }
      const target = discardTargetRef.current
      const contentAtDiscard = contentRef.current
      void pendingSave.then(() => {
        const current = contentRef.current
        if (inFlightRef.current || (current !== target && current !== contentAtDiscard)) return
        runCorrection(target)
      })
    },
    [clearLocalDraft, runCorrection]
  )

  return { saveStatus, saveImmediately, isDirty, discard }
}
