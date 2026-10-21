'use client'

import { useRef, useState } from 'react'
import { Chip, useCopyToClipboard } from '@sim/emcn'
import { Check, Duplicate } from '@sim/emcn/icons'

interface LLMCopyButtonProps {
  markdownUrl: string
}

export function LLMCopyButton({ markdownUrl }: LLMCopyButtonProps) {
  const { copied, copy } = useCopyToClipboard()
  const [status, setStatus] = useState<'idle' | 'pending' | 'ready' | 'failed'>('idle')
  const preparedMarkdown = useRef<string | null>(null)
  const pending = status === 'pending'
  const checked = copied && status === 'idle'

  async function onClick() {
    setStatus('pending')
    const prepare = async () => {
      const response = await fetch(markdownUrl, {
        signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(10000) : undefined,
      })
      if (!response.ok) throw new Error('Could not load page Markdown')
      const markdown = await response.text()
      if (!markdown.trim()) throw new Error('Page Markdown is empty')
      return markdown
    }
    try {
      // Promise-backed writes preserve Safari's transient user activation during the fetch.
      if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function') {
        const success = await copy({ prepare, fallback: '' })
        setStatus(success ? 'idle' : 'failed')
        return
      }
      if (preparedMarkdown.current === null) {
        preparedMarkdown.current = await prepare()
        setStatus('ready')
        return
      }
      const success = await copy(preparedMarkdown.current)
      setStatus(success ? 'idle' : 'failed')
    } catch {
      setStatus('failed')
    }
  }

  return (
    <div className='relative'>
      <Chip
        onClick={onClick}
        disabled={pending}
        aria-busy={pending}
        leftIcon={checked ? Check : Duplicate}
        aria-label={checked ? 'Copied to clipboard' : 'Copy page content'}
      >
        {checked ? 'Copied' : pending ? 'Copying…' : 'Copy page'}
      </Chip>
      <span role='status' className='absolute top-full right-0 whitespace-nowrap text-caption'>
        {status === 'failed'
          ? 'Could not copy. Try again.'
          : status === 'ready'
            ? 'Click again to copy.'
            : ''}
      </span>
    </div>
  )
}
