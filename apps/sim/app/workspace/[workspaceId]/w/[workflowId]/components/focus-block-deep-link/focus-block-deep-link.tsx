'use client'

import { useEffect, useRef } from 'react'
import { useQueryState } from 'nuqs'
import { focusBlockParam } from '@/app/workspace/[workspaceId]/w/[workflowId]/search-params'

interface FocusBlockDeepLinkProps {
  /** Called once with the inbound target. The canvas owns what "focus" means. */
  onTarget: (blockId: string) => void
}

/**
 * Reads the inbound `?block=` target and hands it to the canvas exactly once.
 *
 * Exists as its own component for one structural reason: `useQueryState` reads
 * `useSearchParams`, which Next requires under a Suspense boundary. Confining that read here
 * lets the editor keep its current mount path — no boundary around `Workflow` itself, no
 * `loading.tsx` — and an inner boundary with `fallback={null}` is the sanctioned shape for a
 * suspending leaf that renders nothing.
 *
 * Read-then-strip, behind a ref latch: the target is an instruction, not view-state, so once the
 * canvas has it the param is cleared with `replace` so it neither lingers on the URL nor
 * re-fires when the reader re-renders. Stripping is also what lets a second visit to the same
 * block re-assert the camera rather than being swallowed as "already applied".
 */
export function FocusBlockDeepLink({ onTarget }: FocusBlockDeepLinkProps) {
  const [blockId, setBlockId] = useQueryState(focusBlockParam.key, focusBlockParam.parser)

  /* Ref, so consuming the target does not depend on the caller memoizing `onTarget`. */
  const onTargetRef = useRef(onTarget)
  useEffect(() => {
    onTargetRef.current = onTarget
  }, [onTarget])

  /**
   * Latched while a target is present and released when the param clears — the same shape the
   * canvas's note reveal uses. A latch that only ever set would swallow the second visit to a
   * block, since stripping returns the param to null and arriving again re-supplies the very
   * same id.
   */
  const appliedRef = useRef(false)
  useEffect(() => {
    if (!blockId) {
      appliedRef.current = false
      return
    }
    if (appliedRef.current) return
    appliedRef.current = true
    onTargetRef.current(blockId)
    void setBlockId(null, { history: 'replace', scroll: false })
  }, [blockId, setBlockId])

  return null
}
