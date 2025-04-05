'use client'

import React, { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button, ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface CopyButtonProps extends ButtonProps {
  valueToCopy: string
}

export function CopyButton({ valueToCopy, className, ...props }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(valueToCopy).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000) // Reset icon after 2 seconds
    })
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('h-7 w-7', className)}
      onClick={handleCopy}
      {...props}
    >
      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
      <span className="sr-only">{copied ? 'Copied!' : 'Copy to clipboard'}</span>
    </Button>
  )
}
