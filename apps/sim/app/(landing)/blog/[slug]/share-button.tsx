'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Link2, Linkedin, Twitter } from 'lucide-react'
import { Button } from '@/components/emcn'

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

  const iconButtonClassName = 'h-10 w-10 shrink-0 p-0 active:scale-[0.95]'

  return (
    <div className='flex gap-2'>
      <Button
        type='button'
        onClick={handleShareTwitter}
        className={iconButtonClassName}
        aria-label='Share on X'
        variant='primary'
      >
        <Twitter className='h-4 w-4' aria-hidden='true' />
      </Button>
      <Button
        type='button'
        onClick={handleShareLinkedIn}
        className={iconButtonClassName}
        aria-label='Share on LinkedIn'
        variant='primary'
      >
        <Linkedin className='h-4 w-4' aria-hidden='true' />
      </Button>
      <Button
        type='button'
        onClick={handleCopyLink}
        className={iconButtonClassName}
        aria-label={copied ? 'Link copied' : 'Copy link'}
        variant='primary'
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
      </Button>
    </div>
  )
}
