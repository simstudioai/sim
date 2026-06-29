'use client'

import { useCopyToClipboard } from '../../hooks/use-copy-to-clipboard'
import { Button, Check, Duplicate } from '../../index'
import { cn } from '../../lib/cn'

interface CopyCodeButtonProps {
  code: string
  className?: string
}

export function CopyCodeButton({ code, className }: CopyCodeButtonProps) {
  const { copied, copy } = useCopyToClipboard()

  return (
    <Button
      type='button'
      variant='ghost'
      onClick={() => copy(code)}
      className={cn('flex items-center gap-1 rounded px-1.5 py-0.5 text-xs', className)}
    >
      {copied ? <Check className='size-3.5' /> : <Duplicate className='size-3.5' />}
    </Button>
  )
}
