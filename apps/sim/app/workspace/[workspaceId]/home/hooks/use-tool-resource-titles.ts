import { useEffect, useMemo, useReducer } from 'react'
import { useParams } from 'next/navigation'
import {
  isResourceNameQuery,
  resolveNamedCliToolDisplayTitle,
} from '@/lib/mothership/tools/client/resource-display'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import type { ContentBlock } from '@/app/workspace/[workspaceId]/home/types'
import { useCustomBlockOverlayVersion } from '@/blocks/custom/client-overlay'

/** Refresh existing rows when the sidebar inventory arrives or a resource is renamed. */
export function useToolResourceTitles(blocks: ContentBlock[]): ContentBlock[] {
  const overlayVersion = useCustomBlockOverlayVersion()
  const params = useParams<{ workspaceId?: string }>()
  const workspaceId = params?.workspaceId
  const [revision, refresh] = useReducer((value: number) => value + 1, 0)
  useEffect(() => {
    const cache = getQueryClient().getQueryCache()
    return cache.subscribe((event) => {
      if (
        event.type === 'updated' &&
        event.action.type === 'success' &&
        isResourceNameQuery(event.query.queryKey, workspaceId)
      )
        refresh()
    })
  }, [workspaceId])

  return useMemo(
    () =>
      blocks.map((block) => {
        const tool = block.toolCall
        if (!tool) return block
        const title = resolveNamedCliToolDisplayTitle(tool.name, tool.params, { workspaceId })
        return title && title !== tool.displayTitle
          ? { ...block, toolCall: { ...tool, displayTitle: title } }
          : block
      }),
    [blocks, workspaceId, revision, overlayVersion]
  )
}
