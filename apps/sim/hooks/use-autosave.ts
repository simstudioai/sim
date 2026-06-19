'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface UseAutosaveOptions {
  content: string
  savedContent: string
  onSave: () => Promise<void>
  delay?: number
  enabled?: boolean
}

interface UseAutosaveReturn {
  saveStatus: SaveStatus
  saveImmediately: () => Promise<void>
  isDirty: boolean
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

  const isDirty = content !== savedContent
  const savingStartRef = useRef(0)
  const MIN_SAVING_DISPLAY_MS = 600

  const save = useCallback(async () => {
    if (
      !enabledRef.current ||
      savingRef.current ||
      contentRef.current === savedContentRef.current
    ) {
      return
    }
    savingRef.current = true
    savingStartRef.current = Date.now()
    setSaveStatus('saving')
    let nextStatus: SaveStatus = 'saved'
    try {
      await onSaveRef.current()
    } catch {
      nextStatus = 'error'
    } finally {
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
  }, [])

  useEffect(() => {
    if (!enabled || !isDirty || savingRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(save, delay)
    return () => clearTimeout(timerRef.current)
  }, [content, enabled, isDirty, delay, save])

  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current)
      clearTimeout(idleTimerRef.current)
      clearTimeout(displayTimerRef.current)
      // Flush the latest content on unmount even if a save is mid-flight: that in-flight save
      // captured an older snapshot, so skipping here would terminally drop any edit typed since.
      // The duplicate PUT is idempotent.
      if (enabledRef.current && contentRef.current !== savedContentRef.current) {
        onSaveRef.current().catch(() => {})
      }
    }
  }, [])

  const saveImmediately = useCallback(async () => {
    clearTimeout(timerRef.current)
    await save()
  }, [save])

  return { saveStatus, saveImmediately, isDirty }
}
