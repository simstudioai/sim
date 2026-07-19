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
 * import { SecretReveal } from '../../index'
 *
 * <SecretReveal value={apiKey} />
 * <SecretReveal redacted />
 * ```
 */
'use client'

import { useCopyToClipboard } from '../../hooks/use-copy-to-clipboard'
import { Button, Check, Duplicate } from '../../index'
import { cn } from '../../lib/cn'
import { chipFieldSurfaceClass, chipFieldTextClass } from '../chip/chip-chrome'

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
    <div
      className={cn(
        'flex h-[30px] w-full items-center gap-1.5 px-2',
        chipFieldSurfaceClass,
        className
      )}
    >
      <code
        className={cn(
          chipFieldTextClass,
          'flex-1 truncate font-mono',
          isHidden && 'text-[var(--text-muted)]'
        )}
      >
        {isHidden ? REDACTED_DOTS : value}
      </code>
      {!isHidden && (
        <Button
          variant='ghost'
          className='size-[18px] flex-shrink-0 rounded-sm p-0 text-[var(--text-muted)] hover-hover:text-[var(--text-primary)]'
          onClick={handleCopy}
        >
          {copied ? <Check className='size-[14px]' /> : <Duplicate className='size-[14px]' />}
          <span className='sr-only'>Copy to clipboard</span>
        </Button>
      )}
    </div>
  )
}
