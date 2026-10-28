'use client'

import { OverflowText, SimWordmark } from '@sim/emcn'
import Image from 'next/image'
import Link from 'next/link'
import { GithubIcon } from '@/components/icons'
import { SITE_URL } from '@/lib/core/utils/urls'
import { useBrandConfig } from '@/ee/whitelabeling'

interface ChatHeaderProps {
  chatConfig: {
    title?: string
    customizations?: {
      headerText?: string
      logoUrl?: string
      imageUrl?: string
      primaryColor?: string
    }
  } | null
  starCount: string
}

export function ChatHeader({ chatConfig, starCount }: ChatHeaderProps) {
  const brand = useBrandConfig()
  const customImage = chatConfig?.customizations?.imageUrl || chatConfig?.customizations?.logoUrl

  return (
    <nav
      aria-label='Chat navigation'
      className='flex w-full shrink-0 items-center justify-between gap-3 px-4 pt-3 pb-[21px] sm:px-8 sm:pt-[8.5px] md:px-[44px] md:pt-4'
    >
      <div className='min-w-0 flex-1'>
        <div className='flex min-w-0 items-center gap-3'>
          {customImage && (
            <Image
              src={customImage}
              alt={`${chatConfig?.title || 'Chat'} logo`}
              width={24}
              height={24}
              unoptimized
              className='size-6 shrink-0 rounded-md object-cover'
            />
          )}
          <h2 className='min-w-0 text-[var(--text-primary)] text-lg'>
            <OverflowText
              label={chatConfig?.customizations?.headerText || chatConfig?.title || 'Chat'}
            />
          </h2>
        </div>
      </div>

      {!brand.logoUrl && (
        <div className='flex shrink-0 items-center gap-4'>
          <a
            href='https://github.com/simstudioai/sim'
            target='_blank'
            rel='noopener noreferrer'
            className='hidden items-center gap-2 text-[var(--text-muted)] transition-colors hover-hover:text-[var(--text-primary)] md:flex'
            aria-label={`GitHub repository - ${starCount} stars`}
          >
            <GithubIcon className='size-[16px]' aria-hidden='true' />
            <span aria-live='polite'>{starCount}</span>
          </a>
          {/* Only show Sim logo if no custom branding is set */}

          <Link
            href={SITE_URL}
            target='_blank'
            rel='noopener noreferrer'
            aria-label='Sim home'
            className='flex items-center'
          >
            <SimWordmark />
          </Link>
        </div>
      )}
    </nav>
  )
}
