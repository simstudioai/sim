'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { hydrateBlockVisibility } from '@/blocks/visibility/client'
import { useBlockVisibility } from '@/hooks/queries/block-visibility'

/**
 * Hydrates the client block-visibility overlay for the active workspace so the
 * registry accessors project the viewer's revealed/disabled preview blocks.
 * Mounted once in the workspace layout, next to `CustomBlocksLoader`.
 *
 * First paint needs no prefetch: `preview: true` blocks are fail-closed until
 * this hydrate lands, so the fetch only ever reveals (benign pop-in) or applies
 * a kill switch to an already-public block. Identical refetches are absorbed by
 * the deep-equal guard inside `hydrateBlockVisibility`.
 */
export function BlockVisibilityLoader() {
  const params = useParams()
  const workspaceId = params?.workspaceId as string | undefined
  const { data } = useBlockVisibility(workspaceId)

  useEffect(() => {
    if (!data) return
    hydrateBlockVisibility({
      revealed: new Set(data.revealed),
      disabled: new Set(data.disabled),
      previewTagged: new Set(data.previewTagged),
    })
  }, [data])

  return null
}
