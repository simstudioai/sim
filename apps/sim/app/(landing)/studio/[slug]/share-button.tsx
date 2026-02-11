'use client'

import { useState } from 'react'
import { Share2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverItem, PopoverTrigger } from '@/components/emcn'

interface ShareButtonProps {
  url: string
  title: string
}

export function ShareButton({ url, title }: ShareButtonProps) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => {
        setCopied(false)
        setOpen(false)
      }, 1000)
    } catch {
      setOpen(false)
    }
  }

  const handleShareTwitter = () => {
    const tweetUrl = `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`
    window.open(tweetUrl, '_blank', 'noopener,noreferrer')
    setOpen(false)
  }

  const handleShareLinkedIn = () => {
    const linkedInUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`
    window.open(linkedInUrl, '_blank', 'noopener,noreferrer')
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      variant='secondary'
      size='sm'
      colorScheme='inverted'
    >
      <PopoverTrigger asChild>
        <button
          className='flex items-center gap-1.5 text-gray-600 text-sm hover:text-gray-900'
          aria-label='Share this post'
        >
          <Share2 className='h-4 w-4' />
          <span>Share</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align='end' minWidth={140}>
        <PopoverItem onClick={handleCopyLink}>{copied ? 'Copied!' : 'Copy link'}</PopoverItem>
        <PopoverItem onClick={handleShareTwitter}>Share on X</PopoverItem>
        <PopoverItem onClick={handleShareLinkedIn}>Share on LinkedIn</PopoverItem>
      </PopoverContent>
    </Popover>
  )
}
