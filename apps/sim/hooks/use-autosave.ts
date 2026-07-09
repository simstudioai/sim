'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { del, get, set } from 'idb-keyval'

const logger = createLogger('Autosave')

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface LocalDraft {
  content: string
  savedContent: string
}

const LOCAL_DRAFT_DELAY_MS = 400

function localDraftDbKey(draftKey: string) {
  return `autosave-draft:${draftKey}`
}

interface UseAutosaveOptions {
  content: string
  savedContent: string
  onSave: () => Promise<void>
  delay?: number
  enabled?: boolean
  /**
   * Uniquely identifies the document being edited (e.g. a file id). When set, the draft is
   * mirrored into IndexedDB on a short debounce, independent of the network save, and recovered
   * via `onRestoreDraft` on mount if newer than `savedContent`.
   */
  draftKey?: string
  onRestoreDraft?: (content: string) => void
}

interface UseAutosaveReturn {
  saveStatus: SaveStatus
  saveImmediately: () => Promise<void>
  isDirty: boolean
  /** Abandons the current draft: cancels any pending save/local-draft write and clears the local draft immediately, so nothing written after this call can resurrect it. */
  discard: () => void
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
  draftKey,
  onRestoreDraft,
}: UseAutosaveOptions): UseAutosaveReturn {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const displayTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const savingRef = useRef(false)
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const savedContentRef = useRef(savedContent)
  savedContentRef.current = savedContent
  const contentRef = useRef(content)
  contentRef.current = content
  const effectiveDraftKey = enabled ? draftKey : undefined
  const draftKeyRef = useRef(effectiveDraftKey)
  draftKeyRef.current = effectiveDraftKey
  const onRestoreDraftRef = useRef(onRestoreDraft)
  onRestoreDraftRef.current = onRestoreDraft

  const isDirty = content !== savedContent
  const savingStartRef = useRef(0)
  const inFlightRef = useRef<Promise<void> | null>(null)
  const unmountedRef = useRef(false)
  const localDraftTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const lastPersistedContentRef = useRef<string | null>(null)
  const discardedRef = useRef(false)
  const MIN_SAVING_DISPLAY_MS = 600

  const persistLocalDraft = useCallback(() => {
    const key = draftKeyRef.current
    if (discardedRef.current || !key || contentRef.current === savedContentRef.current) return
    if (contentRef.current === lastPersistedContentRef.current) return
    void set(localDraftDbKey(key), {
      content: contentRef.current,
      savedContent: savedContentRef.current,
    } satisfies LocalDraft)
      .then(() => {
        lastPersistedContentRef.current = contentRef.current
      })
      .catch((error) => {
        logger.warn('IndexedDB draft write failed', { key, error })
      })
  }, [])

  const clearLocalDraft = useCallback(() => {
    const key = draftKeyRef.current
    lastPersistedContentRef.current = null
    if (!key) return
    void del(localDraftDbKey(key)).catch((error) => {
      logger.warn('IndexedDB draft delete failed', { key, error })
    })
  }, [])

  const save = useCallback(async () => {
    if (
      discardedRef.current ||
      !enabledRef.current ||
      savingRef.current ||
      contentRef.current === savedContentRef.current
    ) {
      return
    }
    savingRef.current = true
    savingStartRef.current = Date.now()
    if (!unmountedRef.current) setSaveStatus('saving')
    const run = (async () => {
      let nextStatus: SaveStatus = 'saved'
      try {
        await onSaveRef.current()
      } catch {
        nextStatus = 'error'
      } finally {
        if (unmountedRef.current) {
          savingRef.current = false
        } else {
          const elapsed = Date.now() - savingStartRef.current
          const remaining = Math.max(0, MIN_SAVING_DISPLAY_MS - elapsed)
          displayTimerRef.current = setTimeout(() => {
            setSaveStatus(nextStatus)
            clearTimeout(idleTimerRef.current)
            idleTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
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
    if (!enabled || !isDirty || savingRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(save, delay)
    return () => clearTimeout(timerRef.current)
  }, [content, enabled, isDirty, delay, save])

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
        contentRef.current === savedContentRef.current
      ) {
        return
      }
      // Flush the latest content on unmount, but chain it AFTER any in-flight save rather than
      // firing a concurrent PUT: the in-flight save captured an older snapshot, so writing the
      // latest sequentially (last) prevents an out-of-order completion from clobbering it.
      void (async () => {
        await inFlightRef.current
        if (!discardedRef.current && contentRef.current !== savedContentRef.current) {
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

  useEffect(() => {
    if (!effectiveDraftKey) return
    let cancelled = false
    void get<LocalDraft>(localDraftDbKey(effectiveDraftKey))
      .then((draft) => {
        if (cancelled || !draft || draft.savedContent !== savedContentRef.current) return
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
  }, [effectiveDraftKey])

  const saveImmediately = useCallback(async () => {
    clearTimeout(timerRef.current)
    await save()
  }, [save])

  const discard = useCallback(() => {
    discardedRef.current = true
    clearTimeout(timerRef.current)
    clearTimeout(localDraftTimerRef.current)
    clearLocalDraft()
  }, [clearLocalDraft])

  return { saveStatus, saveImmediately, isDirty, discard }
}
