'use client'

import { useEffect, useMemo } from 'react'
import { useCustomBlockOverlayVersion } from '@/blocks/custom/client-overlay'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSearchModalStore } from '@/stores/modals/search/store'
import { useProvidersStore } from '@/stores/providers'

/**
 * Fills the block and tool catalog the Add block picker and search modal read. The workspace
 * sidebar does this on workspace routes; an editor hosted elsewhere mounts this instead.
 */
export function SearchDataLoader() {
  const { filterBlocks, isToolAllowed } = usePermissionConfig()
  const initializeSearchData = useSearchModalStore((state) => state.initializeData)
  const customBlockOverlayVersion = useCustomBlockOverlayVersion()
  const providers = useProvidersStore((state) => state.providers)
  const providerModelSignature = useMemo(
    () =>
      Object.values(providers)
        .map((provider) => provider.models.join('\x00'))
        .join('\x01'),
    [providers]
  )

  useEffect(() => {
    initializeSearchData(filterBlocks, isToolAllowed)
  }, [
    initializeSearchData,
    filterBlocks,
    isToolAllowed,
    providerModelSignature,
    customBlockOverlayVersion,
  ])

  return null
}
