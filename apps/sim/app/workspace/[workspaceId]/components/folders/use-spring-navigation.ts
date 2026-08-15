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
 * Shared by every foldered list. Files keeps its own drag configuration for OS file drops, but
 * this lifecycle is identical everywhere, and each surface that re-derived a piece of it drifted
 * — the return path in particular went missing on Files while the other two lists had it.
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
  }, [])

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
    springLoad.reset()
  }, [springLoad])

  return useMemo(
    () => ({
      rememberOrigin,
      arm: springLoad.arm,
      disarm: springLoad.disarm,
      markDropHandled,
      end,
    }),
    [rememberOrigin, springLoad.arm, springLoad.disarm, markDropHandled, end]
  )
}
