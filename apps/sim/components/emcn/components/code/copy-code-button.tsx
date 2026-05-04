'use client'

import { Button, Check, Copy } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

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
      {copied ? <Check className='h-[14px] w-[14px]' /> : <Copy className='h-[14px] w-[14px]' />}
    </Button>
  )
}
