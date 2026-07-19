'use client'

/**
 * The canonical password chip field: a {@link ChipInput} with the standard
 * trailing adornment cluster — optional generate, copy, and reveal buttons —
 * styled identically to {@link ChipCopyInput}'s copy button so every
 * "input with buttons on the right" reads as the same control. Owns its
 * reveal/copied UI state; the caller owns the value.
 *
 * @example
 * ```tsx
 * import { ChipPasswordInput } from '../../index'
 *
 * <ChipPasswordInput
 *   value={password}
 *   onChange={setPassword}
 *   onGenerate={() => generatePassword(24)}
 * />
 * ```
 */
import * as React from 'react'
import { useCopyToClipboard } from '../../hooks/use-copy-to-clipboard'
import { Check, Duplicate, Eye, EyeOff, RefreshCw } from '../../icons'
import { Button } from '../button/button'
import { ChipInput, type ChipInputProps } from '../chip-input/chip-input'
import { Tooltip } from '../tooltip/tooltip'

export interface ChipPasswordInputProps
  extends Omit<ChipInputProps, 'value' | 'onChange' | 'endAdornment' | 'type'> {
  /** The password value. */
  value: string
  /** Called with the new value on typing, generate, or clear. */
  onChange: (value: string) => void
  /**
   * Returns a freshly generated password. When provided, a generate button is
   * rendered; clicking it calls `onChange` with the result.
   */
  onGenerate?: () => string
}

const ADORNMENT_BUTTON_CLASS = 'size-[18px] rounded-sm p-0'
const ADORNMENT_ICON_CLASS = 'size-[13px]'

interface AdornmentButtonProps {
  label: string
  activeLabel?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}

function AdornmentButton({
  label,
  activeLabel,
  active = false,
  disabled = false,
  onClick,
  children,
}: AdornmentButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          type='button'
          variant='quiet'
          className={ADORNMENT_BUTTON_CLASS}
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
        >
          {children}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>{active ? (activeLabel ?? label) : label}</Tooltip.Content>
    </Tooltip.Root>
  )
}

/** Forwards its ref to the inner `<input>`, exactly like {@link ChipInput}. */
export const ChipPasswordInput = React.forwardRef<HTMLInputElement, ChipPasswordInputProps>(
  ({ value, onChange, onGenerate, disabled, autoComplete = 'new-password', ...props }, ref) => {
    const [revealed, setRevealed] = React.useState(false)
    const { copied, copy } = useCopyToClipboard()

    return (
      <ChipInput
        ref={ref}
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        autoComplete={autoComplete}
        endAdornment={
          <div className='flex items-center gap-0.5'>
            {onGenerate ? (
              <AdornmentButton
                label='Generate'
                disabled={disabled}
                onClick={() => onChange(onGenerate())}
              >
                <RefreshCw className={ADORNMENT_ICON_CLASS} />
              </AdornmentButton>
            ) : null}
            <AdornmentButton
              label='Copy'
              activeLabel='Copied!'
              active={copied}
              disabled={disabled || !value}
              onClick={() => copy(value)}
            >
              {copied ? (
                <Check className={ADORNMENT_ICON_CLASS} />
              ) : (
                <Duplicate className={ADORNMENT_ICON_CLASS} />
              )}
            </AdornmentButton>
            <AdornmentButton
              label={revealed ? 'Hide' : 'Show'}
              disabled={disabled}
              onClick={() => setRevealed((previous) => !previous)}
            >
              {revealed ? (
                <EyeOff className={ADORNMENT_ICON_CLASS} />
              ) : (
                <Eye className={ADORNMENT_ICON_CLASS} />
              )}
            </AdornmentButton>
          </div>
        }
        {...props}
      />
    )
  }
)

ChipPasswordInput.displayName = 'ChipPasswordInput'
