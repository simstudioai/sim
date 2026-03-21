'use client'

import { useState } from 'react'
import { Check, Linkedin, Link2, Twitter } from 'lucide-react'

interface ShareButtonsProps {
  url: string
  title: string
}

export function ShareButtons({ url, title }: ShareButtonsProps) {
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

  const btnClass =
    'flex h-10 w-10 items-center justify-center rounded-[5px] border border-[#2A2A2A] bg-[#232323] text-[#999] transition-all hover:border-[#2ABBF8] hover:text-[#2ABBF8]'

  return (
    <div className='flex gap-2'>
      <button
        type='button'
        onClick={handleShareTwitter}
        className={btnClass}
        aria-label='Share on X'
      >
        <Twitter className='h-4 w-4' aria-hidden='true' />
      </button>
      <button
        type='button'
        onClick={handleShareLinkedIn}
        className={btnClass}
        aria-label='Share on LinkedIn'
      >
        <Linkedin className='h-4 w-4' aria-hidden='true' />
      </button>
      <button
        type='button'
        onClick={handleCopyLink}
        className={btnClass}
        aria-label={copied ? 'Link copied' : 'Copy link'}
      >
        {copied ? (
          <Check className='h-4 w-4 text-[#00F701]' aria-hidden='true' />
        ) : (
          <Link2 className='h-4 w-4' aria-hidden='true' />
        )}
      </button>
    </div>
  )
}
