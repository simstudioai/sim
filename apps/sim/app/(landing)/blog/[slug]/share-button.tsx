'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Link2, Linkedin, Twitter } from 'lucide-react'

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
    'flex h-10 w-10 items-center justify-center rounded-[5px] border border-[#2A2A2A] bg-[#232323] text-[#999] transition-[color,border-color] duration-150 ease [@media(hover:hover)]:hover:border-[#2ABBF8] [@media(hover:hover)]:hover:text-[#2ABBF8] active:scale-[0.95]'

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
        <AnimatePresence mode='wait'>
          {copied ? (
            <motion.span
              key='check'
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className='flex items-center justify-center'
            >
              <Check className='h-4 w-4 text-[#00F701]' aria-hidden='true' />
            </motion.span>
          ) : (
            <motion.span
              key='link'
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className='flex items-center justify-center'
            >
              <Link2 className='h-4 w-4' aria-hidden='true' />
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    </div>
  )
}
