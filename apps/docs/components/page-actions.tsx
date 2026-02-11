'use client'

import { useCopyButton } from 'fumadocs-ui/utils/use-copy-button'
import { Check, Copy } from 'lucide-react'

export function LLMCopyButton({ content }: { content: string }) {
  const [checked, onClick] = useCopyButton(() => navigator.clipboard.writeText(content))

  return (
    <button
      onClick={onClick}
      className='flex cursor-pointer items-center gap-1.5 rounded-lg border border-border/40 bg-background px-2.5 py-2 text-muted-foreground/60 text-sm leading-none transition-all hover:border-border hover:bg-accent/50 hover:text-muted-foreground'
      aria-label={checked ? 'Copied to clipboard' : 'Copy page content'}
    >
      {checked ? (
        <>
          <Check className='h-3.5 w-3.5' />
          <span>Copied</span>
        </>
      ) : (
        <>
          <Copy className='h-3.5 w-3.5' />
          <span>Copy page</span>
        </>
      )}
    </button>
  )
}
