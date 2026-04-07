'use client'

import { useCopyButton } from 'fumadocs-ui/utils/use-copy-button'
import { Check, Copy } from 'lucide-react'

export function LLMCopyButton({ content }: { content: string }) {
  const [checked, onClick] = useCopyButton(() => navigator.clipboard.writeText(content))

  return (
    <button
      onClick={onClick}
      className='flex cursor-pointer items-center gap-1.5 rounded-[5px] border border-transparent px-2.5 py-2 text-[13px] text-foreground/40 leading-none transition-colors duration-200 hover:border-border/40 hover:bg-neutral-100 hover:text-foreground/70 dark:hover:bg-neutral-800'
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
