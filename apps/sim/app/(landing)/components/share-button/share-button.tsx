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
import { buildLinkedInShareUrl, buildXShareUrl } from '@/lib/social-share'

interface ShareButtonProps {
  url: string
  title: string
}

/** Bordered `Chip` trigger with a copy-link / X / LinkedIn share menu — the one Share control used across blog, library, integration, and model pages. */
export function ShareButton({ url, title }: ShareButtonProps) {
  const { copied, copy } = useCopyToClipboard({ resetMs: 1500 })

  const handleShareTwitter = () => {
    window.open(buildXShareUrl(`${title} ${url}`), '_blank', 'noopener,noreferrer')
  }

  const handleShareLinkedIn = () => {
    window.open(buildLinkedInShareUrl(url), '_blank', 'noopener,noreferrer')
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
