'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

interface CopyPageButtonProps {
  content: string
}

export function CopyPageButton({ content }: CopyPageButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <button
      onClick={handleCopy}
      className='flex items-center gap-1.5 rounded-lg border border-border/40 bg-background px-2.5 py-1.5 text-muted-foreground/60 text-sm shadow-sm transition-all hover:border-border hover:bg-accent/50 hover:text-muted-foreground'
      aria-label={copied ? 'Copied to clipboard' : 'Copy page content'}
    >
      {copied ? (
        <>
          <Check className='h-4 w-4' />
          <span>Copied</span>
        </>
      ) : (
        <>
          <Copy className='h-4 w-4' />
          <span>Copy page</span>
        </>
      )}
    </button>
  )
}
