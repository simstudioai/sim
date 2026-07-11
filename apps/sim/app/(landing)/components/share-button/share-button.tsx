'use client'

import {
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  TRIGGER_BORDER_CLASS,
  useCopyToClipboard,
} from '@sim/emcn'
import { Duplicate } from '@sim/emcn/icons'
import { Share2 } from 'lucide-react'
import { LinkedInIcon, xIcon as XIcon } from '@/components/icons'

interface ShareButtonProps {
  url: string
  title: string
}

/** Bordered `Chip` trigger with a copy-link / X / LinkedIn share menu — the one Share control used across blog, library, integration, and model pages. */
export function ShareButton({ url, title }: ShareButtonProps) {
  const { copied, copy } = useCopyToClipboard({ resetMs: 1500 })

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
        <Chip leftIcon={Share2} className={TRIGGER_BORDER_CLASS} aria-label='Share this page'>
          Share
        </Chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuItem onSelect={() => copy(url)}>
          <Duplicate className='size-4' />
          {copied ? 'Copied!' : 'Copy link'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleShareTwitter}>
          <XIcon className='size-4' />
          Share on X
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleShareLinkedIn}>
          <LinkedInIcon className='size-4' />
          Share on LinkedIn
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
