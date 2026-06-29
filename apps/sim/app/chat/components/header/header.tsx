'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { GithubIcon } from '@/components/icons'
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
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  const brand = useBrandConfig()
  const primaryColor = chatConfig?.customizations?.primaryColor || 'var(--brand)'
  const customImage = chatConfig?.customizations?.imageUrl || chatConfig?.customizations?.logoUrl

  return (
    <nav
      aria-label={t('chat_navigation')}
      className={`flex w-full items-center justify-between px-4 pt-3 pb-[21px] sm:px-8 sm:pt-[8.5px] md:px-[44px] md:pt-4`}
    >
      <div className='flex items-center gap-[34px]'>
        <div className='flex items-center gap-3'>
          {customImage && (
            <Image
              src={customImage}
              alt={`${chatConfig?.title || 'Chat'} logo`}
              width={24}
              height={24}
              unoptimized
              className='size-6 rounded-md object-cover'
            />
          )}
          <h2 className='font-medium text-[var(--landing-text)] text-lg'>
            {chatConfig?.customizations?.headerText || chatConfig?.title || tI18n('chat')}
          </h2>
        </div>
      </div>

      {!brand.logoUrl && (
        <div className='flex items-center gap-4'>
          <a
            href='https://github.com/simstudioai/sim'
            target='_blank'
            rel='noopener noreferrer'
            className='flex items-center gap-2 text-[var(--landing-text-muted)] text-md transition-colors hover:text-[var(--landing-text)]'
            aria-label={`GitHub repository - ${starCount} stars`}
          >
            <GithubIcon className='size-[16px]' aria-hidden='true' />
            <span aria-live='polite'>{starCount}</span>
          </a>
          {/* Only show Sim logo if no custom branding is set */}

          <Link
            href='https://sim.ai'
            target='_blank'
            rel='noopener noreferrer'
            aria-label={t('sim_home')}
          >
            <Image
              src='/logo/sim-landing.svg'
              alt={t('sim')}
              width={71}
              height={22}
              className='h-[22px] w-auto'
              priority
            />
          </Link>
        </div>
      )}
    </nav>
  )
}
