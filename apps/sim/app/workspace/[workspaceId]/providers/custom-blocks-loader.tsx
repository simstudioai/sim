'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { buildCustomBlockConfig } from '@/blocks/custom/build-config'
import { hydrateClientCustomBlocks } from '@/blocks/custom/client-overlay'
import { getCustomBlockIcon } from '@/blocks/custom/custom-block-icon'
import { useCustomBlocks } from '@/hooks/queries/custom-blocks'

/**
 * Hydrates the client custom-block registry overlay from the active workspace's
 * org custom blocks. Mounted once in the workspace layout so every surface that
 * resolves blocks synchronously — the canvas, the block palette, copilot mentions,
 * and the Access Control "Blocks" list — sees custom blocks. Re-hydrates on
 * workspace switch (the query key changes) and on any publish/edit/unpublish.
 */
export function CustomBlocksLoader() {
  const params = useParams()
  const workspaceId = params?.workspaceId as string | undefined
  const { data } = useCustomBlocks(workspaceId)

  useEffect(() => {
    hydrateClientCustomBlocks(
      // Only enabled blocks are resolvable/executable server-side, so the client
      // overlay (toolbar, canvas, palette) must exclude disabled ones too — else
      // the block is offered but every run fails.
      (data ?? [])
        .filter((block) => block.enabled)
        .map((block) =>
          buildCustomBlockConfig(
            {
              type: block.type,
              name: block.name,
              description: block.description,
              workflowId: block.workflowId,
              exposedOutputs: block.exposedOutputs,
            },
            block.inputFields,
            {
              icon: getCustomBlockIcon(block.iconUrl),
              bgColor: block.iconUrl ? 'transparent' : undefined,
            }
          )
        )
    )
  }, [data])

  return null
}
