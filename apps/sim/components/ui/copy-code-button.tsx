'use client'

import { useCallback, useState } from 'react'
import { Check, Copy } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

interface CopyCodeButtonProps {
  code: string
  className?: string
}

export function CopyCodeButton({ code, className }: CopyCodeButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code])

  return (
    <button
      type='button'
      onClick={handleCopy}
      className={cn(
        'flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors',
        className
      )}
    >
      {copied ? <Check className='size-3.5' /> : <Copy className='size-3.5' />}
    </button>
  )
}
