/**
 * A read-only display for a one-time secret reveal: the value renders inside
 * a bordered code box with a copy button, or as masked dots when redacted.
 *
 * @remarks
 * Use for surfaces that show a freshly-generated credential (API key, signing
 * secret, etc.) once and then need to fall back to a redacted state on
 * subsequent renders. Pair with `redacted` (or simply omit `value`) to render
 * the masked state without a copy affordance.
 *
 * @example
 * ```tsx
 * import { SecretReveal } from '@/components/emcn'
 *
 * <SecretReveal value={apiKey} />
 * <SecretReveal redacted />
 * ```
 */
'use client'

import { Button, Check, Copy } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

const REDACTED_DOTS = '••••••••••••••••••••••••••••••••'

export interface SecretRevealProps {
  /** Secret value to display. When absent or `redacted` is true, renders masked dots. */
  value?: string
  /** Force the masked state even when `value` is provided. */
  redacted?: boolean
  className?: string
}

export function SecretReveal({ value, className, redacted = false }: SecretRevealProps) {
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
