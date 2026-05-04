'use client'

import { Button, Check, Copy } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

const REDACTED_DOTS = '••••••••••••••••••••••••••••••••'

interface ApiKeyRevealProps {
  value?: string
  className?: string
  redacted?: boolean
}

export function ApiKeyReveal({ value, className, redacted = false }: ApiKeyRevealProps) {
  const { copied, copy } = useCopyToClipboard()
  const isHidden = redacted || !value

  const handleCopy = () => {
    if (isHidden || !value) return
    copy(value)
  }

  return (
    <div className={cn('relative', className)}>
      <div
        className={cn(
          'flex h-9 items-center rounded-md border bg-[var(--surface-1)] px-2.5',
          !isHidden && 'pr-10'
        )}
      >
        <code
          className={cn(
            'flex-1 truncate font-mono text-sm',
            isHidden ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'
          )}
        >
          {isHidden ? REDACTED_DOTS : value}
        </code>
      </div>
      {!isHidden && (
        <Button
          variant='ghost'
          className='-translate-y-1/2 absolute top-1/2 right-[4px] h-[28px] w-[28px] rounded-sm text-[var(--text-muted)] hover-hover:text-[var(--text-primary)]'
          onClick={handleCopy}
        >
          {copied ? (
            <Check className='h-[14px] w-[14px]' />
          ) : (
            <Copy className='h-[14px] w-[14px]' />
          )}
          <span className='sr-only'>Copy to clipboard</span>
        </Button>
      )}
    </div>
  )
}
