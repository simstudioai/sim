'use client'

import { useCallback, useMemo, useRef } from 'react'
import {
  type SpringOpenOptions,
  useSpringLoadedFolder,
} from '@/app/workspace/[workspaceId]/components/folders/use-spring-loaded-folder'

export interface UseSpringNavigationOptions {
  /** The folder the list is currently showing (`null` at the workspace root). */
  currentFolderId: string | null
  /**
   * Navigates the list. Called both to spring a folder open mid-drag and to return to where the
   * drag began. Omit to disable spring navigation entirely.
   */
  onNavigate?: (folderId: string | null, options: SpringOpenOptions) => void
}

export interface SpringNavigation {
  /** Records where this drag began. Call from `dragstart`. */
  rememberOrigin: () => void
  /** Starts (or continues) the timer that opens `folderId`. Safe to call on every `dragover`. */
  arm: (folderId: string | null) => void
  /** Cancels a pending open — the drag left the target. */
  disarm: () => void
  /** Marks that a drop actually moved something, so the destination stays on screen. */
  markDropHandled: () => void
  /** Ends the drag, returning to the origin when the spring-opens went unused. */
  end: () => void
}

/**
 * Spring-loaded folder navigation for a drag, including the way back out.
 *
 * Opening a folder mid-drag is only half a gesture. A drag that springs its way several levels
 * deep and is then cancelled — or dropped somewhere else — would otherwise leave the user in a
 * folder they never chose to open, looking at a list they did not ask for. So the navigation is
 * treated as part of the drag: unless a drop actually landed, ending the drag returns to where
 * it started. The workflow sidebar collapses its own spring-opened folders for the same reason.
 *
 * Shared by every foldered list, including a drag of OS files onto the Files page.
 */
export function useSpringNavigation({
  currentFolderId,
  onNavigate,
}: UseSpringNavigationOptions): SpringNavigation {
  const currentFolderIdRef = useRef(currentFolderId)
  currentFolderIdRef.current = currentFolderId

  const onNavigateRef = useRef(onNavigate)
  onNavigateRef.current = onNavigate

  const originFolderIdRef = useRef<string | null>(null)
  /** Whether this drag has an origin yet. A drag of OS files fires no `dragstart` of ours. */
  const hasOriginRef = useRef(false)
  const didSpringOpenRef = useRef(false)
  const dropHandledRef = useRef(false)

  const springLoad = useSpringLoadedFolder({
    onSpringOpen: (folderId, options) => {
      didSpringOpenRef.current = true
      onNavigateRef.current?.(folderId, options)
    },
  })

  const rememberOrigin = useCallback(() => {
    originFolderIdRef.current = currentFolderIdRef.current
    hasOriginRef.current = true
  }, [])

  /**
   * Seeds the origin for a drag that never reached {@link SpringNavigation.rememberOrigin} — a
   * drag of OS files starts outside the page, so there is no `dragstart` of ours to record it.
   * Without this the return lands on whatever folder the PREVIOUS drag began in.
   *
   * Refuses the folder already on screen. That target is not a navigation, and arming it is how
   * a drag resting on one spot would re-open the same folder over and over: the underlying timer
   * lets a folder spring more than once per drag so the user can descend, back out through the
   * breadcrumb, and descend again.
   */
  const arm = useCallback(
    (folderId: string | null) => {
      if (folderId === currentFolderIdRef.current) {
        springLoad.disarm()
        return
      }
      if (!hasOriginRef.current) {
        originFolderIdRef.current = currentFolderIdRef.current
        hasOriginRef.current = true
      }
      springLoad.arm(folderId)
    },
    [springLoad.arm, springLoad.disarm]
  )

  const markDropHandled = useCallback(() => {
    dropHandledRef.current = true
  }, [])

  const end = useCallback(() => {
    /**
     * `replace`, not `push`: the spring-opens are being undone, so they should leave no trace in
     * the back stack rather than a trail the user has to walk back out of.
     */
    if (
      didSpringOpenRef.current &&
      !dropHandledRef.current &&
      originFolderIdRef.current !== currentFolderIdRef.current
    ) {
      onNavigateRef.current?.(originFolderIdRef.current, { history: 'replace' })
    }
    didSpringOpenRef.current = false
    dropHandledRef.current = false
    hasOriginRef.current = false
    springLoad.reset()
  }, [springLoad])

  return useMemo(
    () => ({
      rememberOrigin,
      arm,
      disarm: springLoad.disarm,
      markDropHandled,
      end,
    }),
    [rememberOrigin, arm, springLoad.disarm, markDropHandled, end]
  )
}
