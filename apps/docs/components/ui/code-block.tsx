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
      Actions={({ children, className }) => (
        <div className={cn('empty:hidden', className)}>
          {/* Custom copy button */}
          <button
            type='button'
            aria-label={copied ? 'Copied Text' : 'Copy Text'}
            onClick={(e) => {
              const pre = (e.currentTarget as HTMLElement)
                .closest('.nd-codeblock')
                ?.querySelector('pre')
              if (pre) handleCopy(pre.textContent || '')
            }}
            className={cn(
              'rounded-md p-2 transition-all',
              'border border-border bg-background/80 hover:bg-muted',
              'backdrop-blur-sm'
            )}
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
