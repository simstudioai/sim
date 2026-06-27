'use client'

import { useState } from 'react'
import { Share2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { Duplicate } from '@/components/emcn/icons'
import { LinkedInIcon, xIcon as XIcon } from '@/components/icons'
import { useTranslations } from 'next-intl'

interface ShareButtonProps {
  url: string
  title: string
}

export function ShareButton({ url, title }: ShareButtonProps) {
  const t = useTranslations('auto')
  const [copied, setCopied] = useState(false)

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  const handleShareTwitter = () => {
    const tweetUrl = `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`
    window.open(tweetUrl, '_blank', 'noopener,noreferrer')
  }

  const handleShareLinkedIn = () => {
    const linkedInUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`
    window.open(linkedInUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className='flex items-center gap-1.5 text-[var(--landing-text-muted)] text-sm hover:text-[var(--landing-text)]'
          aria-label={t('share_this_post')}
        >
          <Share2 className='h-4 w-4' />
          <span>{t('share')}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuItem onSelect={handleCopyLink}>
          <Duplicate className='h-4 w-4' />
          {copied ? 'Copied!' : 'Copy link'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleShareTwitter}>
          <XIcon className='h-4 w-4' />
          {t('share_on_x')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleShareLinkedIn}>
          <LinkedInIcon className='h-4 w-4' />
          {t('share_on_linkedin')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
