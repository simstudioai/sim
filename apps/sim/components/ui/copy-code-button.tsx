'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

interface CopyCodeButtonProps {
  code: string
  className?: string
}

export function CopyCodeButton({ code, className }: CopyCodeButtonProps) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 2000)
  }, [code])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

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
