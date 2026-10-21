'use client'

import { useState } from 'react'
import { Chip, useCopyToClipboard } from '@sim/emcn'
import { Check, Duplicate } from '@sim/emcn/icons'

interface LLMCopyButtonProps {
  markdownUrl: string
}

export function LLMCopyButton({ markdownUrl }: LLMCopyButtonProps) {
  const { copied, copy } = useCopyToClipboard()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const checked = copied && !pending && !failed

  async function onClick() {
    setPending(true)
    setFailed(false)
    const prepare = async () => {
      const response = await fetch(markdownUrl, {
        signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(10000) : undefined,
      })
      if (!response.ok) throw new Error('Could not load page Markdown')
      return response.text()
    }
    try {
      // Promise-backed writes preserve Safari's transient user activation during the fetch.
      const success =
        typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function'
          ? await copy({ prepare, fallback: '' })
          : await copy(await prepare())
      setFailed(!success)
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
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
        {failed ? 'Could not copy. Try again.' : ''}
      </span>
    </div>
  )
}
