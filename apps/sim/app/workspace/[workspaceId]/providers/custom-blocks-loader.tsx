'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { buildCustomBlockConfig } from '@/blocks/custom/build-config'
import { hydrateClientCustomBlocks } from '@/blocks/custom/client-overlay'
import { getCustomBlockIcon } from '@/blocks/custom/custom-block-icon'
import { useWhitelabelSettings } from '@/ee/whitelabeling/hooks/whitelabel'
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

  // Blocks with no uploaded icon fall back to the org's whitelabel logo, then the
  // default glyph. All blocks share the org, so read it off the first row.
  const { data: whitelabel } = useWhitelabelSettings(data?.[0]?.organizationId)
  const fallbackIconUrl = whitelabel?.logoUrl ?? null

  useEffect(() => {
    hydrateClientCustomBlocks(
      // Disabled blocks stay resolvable (so a still-placed instance renders on the
      // canvas and survives serialization instead of vanishing) but are hidden from
      // the palette so no new instance can be placed; a run fails loudly server-side.
      (data ?? []).map((block) => {
        const effectiveIcon = block.iconUrl || fallbackIconUrl
        return buildCustomBlockConfig(
          {
            type: block.type,
            name: block.name,
            description: block.description,
            workflowId: block.workflowId,
            exposedOutputs: block.exposedOutputs,
          },
          block.inputFields,
          {
            icon: getCustomBlockIcon(block.iconUrl, fallbackIconUrl),
            bgColor: effectiveIcon ? 'transparent' : undefined,
            hideFromToolbar: !block.enabled,
          }
        )
      })
    )
  }, [data, fallbackIconUrl])

  return null
}
