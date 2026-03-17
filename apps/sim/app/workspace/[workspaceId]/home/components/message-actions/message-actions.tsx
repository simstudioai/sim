'use client'

import { useCallback, useState } from 'react'
import { Check, Copy, Ellipsis, Hash } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
  PopoverTrigger,
} from '@/components/emcn'

interface MessageActionsProps {
  content: string
  requestId?: string
}

export function MessageActions({ content, requestId }: MessageActionsProps) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<'message' | 'request' | null>(null)

  const copyToClipboard = useCallback(async (text: string, type: 'message' | 'request') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(type)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      // Silently fail
    }
    setOpen(false)
  }, [])

  return (
    <Popover variant='default' size='sm' open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type='button'
          className='rounded-md p-1 text-[var(--text-icon)] opacity-0 transition-opacity hover:bg-[var(--surface-3)] group-hover/msg:opacity-100 data-[state=open]:opacity-100'
          onClick={(e) => e.stopPropagation()}
        >
          <Ellipsis className='h-[14px] w-[14px]' strokeWidth={2} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side='bottom'
        align='end'
        sideOffset={4}
        maxHeight={120}
        style={{ width: '160px', minWidth: '160px' }}
      >
        <PopoverScrollArea>
          <PopoverItem onClick={() => copyToClipboard(content, 'message')} disabled={!content}>
            {copied === 'message' ? (
              <Check className='h-[13px] w-[13px]' />
            ) : (
              <Copy className='h-[13px] w-[13px]' />
            )}
            <span>Copy Message</span>
          </PopoverItem>
          <PopoverItem
            onClick={() => requestId && copyToClipboard(requestId, 'request')}
            disabled={!requestId}
          >
            {copied === 'request' ? (
              <Check className='h-[13px] w-[13px]' />
            ) : (
              <Hash className='h-[13px] w-[13px]' />
            )}
            <span>Copy Request ID</span>
          </PopoverItem>
        </PopoverScrollArea>
      </PopoverContent>
    </Popover>
  )
}
