'use client'

/**
 * The canonical "view only" chip field: a read-only {@link ChipInput} at full
 * opacity with a trailing copy-to-clipboard button. View-only is a display
 * mode, not a disabled state — the value stays fully legible and selectable;
 * only the copy adornment marks it as non-editable. Reach for this (or
 * `ChipModalField type='copy'`, which renders it) instead of a `disabled`
 * input whenever a field shows a value the user cannot change — identifiers,
 * derived values, record details.
 *
 * @example
 * ```tsx
 * import { ChipCopyInput } from '@/components/emcn'
 *
 * <ChipCopyInput value={credential.id} copyLabel='Copy credential ID' />
 * ```
 */
import * as React from 'react'
import { Button } from '@/components/emcn/components/button/button'
import { ChipInput, type ChipInputProps } from '@/components/emcn/components/chip-input/chip-input'
import { Tooltip } from '@/components/emcn/components/tooltip/tooltip'
import { Check, Duplicate } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

export interface ChipCopyInputProps
  extends Omit<ChipInputProps, 'value' | 'onChange' | 'readOnly' | 'endAdornment' | 'type'> {
  /** The value displayed and copied. */
  value: string
  /**
   * Accessible label and tooltip for the copy button.
   * @default 'Copy'
   */
  copyLabel?: string
}

/** Forwards its ref to the inner `<input>`, exactly like {@link ChipInput}. */
export const ChipCopyInput = React.forwardRef<HTMLInputElement, ChipCopyInputProps>(
  ({ value, copyLabel = 'Copy', inputClassName, ...props }, ref) => {
    const { copied, copy } = useCopyToClipboard()

    return (
      <ChipInput
        ref={ref}
        readOnly
        value={value}
        inputClassName={cn('cursor-default', inputClassName)}
        endAdornment={
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                type='button'
                variant='quiet'
                className='size-[18px] rounded-sm p-0'
                onClick={() => copy(value)}
                aria-label={copyLabel}
              >
                {copied ? <Check className='size-[13px]' /> : <Duplicate className='size-[13px]' />}
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>{copied ? 'Copied!' : copyLabel}</Tooltip.Content>
          </Tooltip.Root>
        }
        {...props}
      />
    )
  }
)

ChipCopyInput.displayName = 'ChipCopyInput'
