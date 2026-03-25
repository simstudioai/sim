'use client'

import type { ComponentProps, ReactNode } from 'react'
import { useCopyButton } from 'fumadocs-ui/utils/use-copy-button'
import { Check, Copy } from 'lucide-react'
import { MarkdownCopyButton, ViewOptionsPopover } from '@/components/ai/page-actions'
import { cn } from '@/lib/utils'

export { ViewOptionsPopover }

type ButtonProps = Omit<ComponentProps<'button'>, 'onClick'>

export interface LLMCopyButtonProps extends ButtonProps {
  /**
   * Plain text content to copy (used for API pages where we generate content server-side).
   */
  content?: string
  /**
   * URL to fetch the raw Markdown/MDX content from (used for normal docs pages).
   */
  markdownUrl?: string
  children?: ReactNode
}

function ContentCopyButton({ content, className, ...props }: { content: string } & ButtonProps) {
  const [checked, onClick] = useCopyButton(() => navigator.clipboard.writeText(content))

  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border/40 bg-background px-2.5 py-1.5 text-muted-foreground/60 text-sm transition-all hover:border-border hover:bg-accent/50 hover:text-muted-foreground',
        className
      )}
      aria-label={checked ? 'Copied to clipboard' : 'Copy page content'}
      {...props}
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

export function LLMCopyButton({
  content,
  markdownUrl,
  children,
  className,
  ...props
}: LLMCopyButtonProps) {
  if (markdownUrl) {
    return (
      <MarkdownCopyButton markdownUrl={markdownUrl} className={className} {...props}>
        {children ?? 'Copy Markdown'}
      </MarkdownCopyButton>
    )
  }

  if (!content) return null

  return <ContentCopyButton content={content} className={className} {...props} />
}
