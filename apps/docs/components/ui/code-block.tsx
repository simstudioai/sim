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
      Actions={({ className }) => (
        <div className={cn('empty:hidden', className)}>
          <button
            type='button'
            aria-label={copied ? 'Copied Text' : 'Copy Text'}
            onClick={(e) => {
              const pre = (e.currentTarget as HTMLElement).closest('figure')?.querySelector('pre')
              if (pre) handleCopy(pre.textContent || '')
            }}
            className='cursor-pointer rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground'
          >
            <span className='flex items-center justify-center'>
              {copied ? (
                <Check size={16} className='text-green-600 dark:text-green-400' />
              ) : (
                <Copy size={16} className='text-muted-foreground' />
              )}
            </span>
          </button>
        </div>
      )}
    />
  )
}
