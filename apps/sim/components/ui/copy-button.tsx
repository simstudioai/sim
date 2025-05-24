'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface CopyButtonProps {
  text: string
  className?: string
  showLabel?: boolean
}

export function CopyButton({ text, className = '', showLabel = true }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className='absolute top-1 right-1 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100'>
      {showLabel && (
        <div className='rounded-md bg-background/80 px-2 py-1 text-muted-foreground text-xs'>
          {copied ? 'Copied!' : 'Click to copy'}
        </div>
      )}
      <Button
        type='button'
        variant='ghost'
        size='icon'
        className={`h-6 w-6 p-0 ${className}`}
        onClick={(e) => {
          e.stopPropagation() // Prevent click from affecting parent elements
          copyToClipboard()
        }}
        title='Copy to clipboard'
      >
        {copied ? (
          <Check className='h-3.5 w-3.5 text-green-500' />
        ) : (
          <Copy className='h-3.5 w-3.5 text-muted-foreground' />
        )}
      </Button>
    </div>
  )
}
