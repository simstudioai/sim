'use client'

import Image from 'next/image'
import { buildSharedByLabel } from '@/lib/public-shares/provenance'
import { Navbar } from '@/app/(landing)/components/navbar'
import { ShareLinkButton } from '@/app/(landing)/components/share-link-button'
import { useBrandConfig } from '@/ee/whitelabeling'

interface ChatHeaderProps {
  chatConfig: {
    title?: string
    sharedByName?: string
    customizations?: {
      headerText?: string
      logoUrl?: string
      imageUrl?: string
      primaryColor?: string
    }
  } | null
}

/**
 * Deployed-chat header — the shared {@link Navbar} in `logoOnly` mode, so a
 * public chat wears the same wordmark, geometry, name, and "Shared by" credit as
 * the shared file/interface surfaces. The chat keeps its per-deployment custom
 * logo image on the brand-side `nameIcon` slot; the Sim wordmark is dropped when
 * the instance is whitelabeled (`brand.logoUrl`), matching the prior behaviour,
 * while the custom chat logo shows whenever it is configured.
 */
export function ChatHeader({ chatConfig }: ChatHeaderProps) {
  const brand = useBrandConfig()
  const customImage = chatConfig?.customizations?.imageUrl || chatConfig?.customizations?.logoUrl
  const title = chatConfig?.customizations?.headerText || chatConfig?.title || 'Chat'

  return (
    <Navbar
      logoOnly
      name={title}
      meta={buildSharedByLabel(chatConfig?.sharedByName ?? null)}
      hideBrand={Boolean(brand.logoUrl)}
      actions={<ShareLinkButton title={title} kind='Chat' />}
      nameIcon={
        customImage ? (
          <Image
            src={customImage}
            alt={`${chatConfig?.title || 'Chat'} logo`}
            width={24}
            height={24}
            unoptimized
            className='size-6 rounded-md object-cover'
          />
        ) : undefined
      }
    />
  )
}
