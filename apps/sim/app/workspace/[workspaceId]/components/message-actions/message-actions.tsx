'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, Ellipsis, Hash } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/emcn'

interface MessageActionsProps {
  content: string
  requestId?: string
}

export function MessageActions({ content, requestId }: MessageActionsProps) {
  const [copied, setCopied] = useState<'message' | 'request' | null>(null)
  const resetTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current)
      }
    }
  }, [])

  const copyToClipboard = useCallback(async (text: string, type: 'message' | 'request') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(type)
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current)
      }
      resetTimeoutRef.current = window.setTimeout(() => setCopied(null), 1500)
    } catch {
      return
    }
  }, [])

  if (!content && !requestId) {
    return null
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          aria-label='More options'
          className='flex h-5 w-5 items-center justify-center rounded-sm text-[var(--text-icon)] opacity-0 transition-colors transition-opacity hover-hover:bg-[var(--surface-3)] hover-hover:text-[var(--text-primary)] focus-visible:opacity-100 focus-visible:outline-none group-hover/msg:opacity-100 data-[state=open]:opacity-100'
          onClick={(event) => event.stopPropagation()}
        >
          <Ellipsis className='h-3 w-3' strokeWidth={2} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' side='top' sideOffset={4}>
        <DropdownMenuItem
          disabled={!content}
          onSelect={(event) => {
            event.stopPropagation()
            void copyToClipboard(content, 'message')
          }}
        >
          {copied === 'message' ? <Check /> : <Copy />}
          <span>Copy Message</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!requestId}
          onSelect={(event) => {
            event.stopPropagation()
            if (requestId) {
              void copyToClipboard(requestId, 'request')
            }
          }}
        >
          {copied === 'request' ? <Check /> : <Hash />}
          <span>Copy Request ID</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
