'use client'

import { useState } from 'react'
import { CodeBlock as FumadocsCodeBlock } from 'fumadocs-ui/components/codeblock'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

export function CodeBlock(props: React.ComponentProps<typeof FumadocsCodeBlock>) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <FumadocsCodeBlock
      {...props}
      className={cn('!border !border-[var(--border)] !shadow-none', props.className)}
      Actions={({ className }) => (
        <div className={cn('empty:hidden', className)}>
          <button
            type='button'
            aria-label={copied ? 'Copied Text' : 'Copy Text'}
            onClick={(e) => {
              const pre = (e.currentTarget as HTMLElement).closest('figure')?.querySelector('pre')
              if (pre) handleCopy(pre.textContent || '')
            }}
            className='cursor-pointer rounded-md p-2 text-[var(--text-muted)] transition-colors hover:text-[var(--text-icon)]'
          >
            <span className='flex items-center justify-center'>
              {copied ? (
                <Check size={16} className='text-[var(--brand-accent)]' />
              ) : (
                <Copy size={16} className='text-[var(--text-muted)]' />
              )}
            </span>
          </button>
        </div>
      )}
    />
  )
}
