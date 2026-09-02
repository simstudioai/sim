'use client'

import { useState } from 'react'
import { Button, ChipInput, Loader, Tooltip, useCopyToClipboard } from '@sim/emcn'
import { Check, Clipboard, Eye, EyeOff, RefreshCw } from '@sim/emcn/icons'
import { generatePassword } from '@/lib/core/security/encryption'

const MASKED_PASSWORD = '••••••••'

interface GeneratedPasswordInputProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  /** Show the Generate (random password) action. Off for consumer-facing entry forms. */
  showGenerate?: boolean
  required?: boolean
  autoComplete?: string
  error?: boolean
  /**
   * Resolves the currently saved password when the Show toggle is clicked.
   * While hidden, an empty field displays a masked placeholder.
   */
  fetchCurrentPassword?: () => Promise<string>
}

/**
 * Password field with reveal / copy / (optional) generate adornments, used by the
 * deploy-as-chat access controls and the file-share modal. Owns its show/copy UI
 * state; the caller owns the value.
 */
export function GeneratedPasswordInput({
  value,
  onChange,
  disabled = false,
  placeholder,
  showGenerate = true,
  required = false,
  autoComplete = 'new-password',
  error = false,
  fetchCurrentPassword,
}: GeneratedPasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState<string | null>(null)
  const [isFetchingCurrent, setIsFetchingCurrent] = useState(false)
  const { copied, copy } = useCopyToClipboard()

  const displayValue = currentPassword ?? value
  const displayPlaceholder = fetchCurrentPassword && !displayValue ? MASKED_PASSWORD : placeholder

  const handleChange = (nextValue: string) => {
    setCurrentPassword(null)
    onChange(nextValue)
  }

  const handleGeneratePassword = () => {
    handleChange(generatePassword(24))
  }

  const toggleShowPassword = async () => {
    if (showPassword) {
      setShowPassword(false)
      /**
       * Discard the fetched password instead of masking it. Keeping it would
       * leave the plaintext in the input's DOM value and keep Copy armed while
       * the field reads as hidden. A later reveal re-fetches, which also keeps
       * the audit log at one entry per disclosure. An edited value lives in
       * `value` and is deliberately untouched.
       */
      setCurrentPassword(null)
      return
    }

    if (!displayValue && fetchCurrentPassword) {
      setIsFetchingCurrent(true)
      try {
        setCurrentPassword(await fetchCurrentPassword())
      } catch {
        return
      } finally {
        setIsFetchingCurrent(false)
      }
    }

    setShowPassword(true)
  }

  return (
    <ChipInput
      type={showPassword ? 'text' : 'password'}
      placeholder={displayPlaceholder}
      value={displayValue}
      onChange={(e) => handleChange(e.target.value)}
      disabled={disabled}
      required={required}
      autoComplete={autoComplete}
      error={error}
      endAdornment={
        <div className='flex items-center'>
          {showGenerate ? (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  type='button'
                  variant='ghost'
                  onClick={handleGeneratePassword}
                  disabled={disabled}
                  aria-label='Generate password'
                  className='p-1.5!'
                >
                  <RefreshCw className='size-3' />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>
                <span>Generate</span>
              </Tooltip.Content>
            </Tooltip.Root>
          ) : null}
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                type='button'
                variant='ghost'
                onClick={() => copy(displayValue)}
                disabled={!displayValue || disabled}
                aria-label='Copy password'
                className='p-1.5!'
              >
                {copied ? <Check className='size-3' /> : <Clipboard className='size-3' />}
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </Tooltip.Content>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                type='button'
                variant='ghost'
                onClick={toggleShowPassword}
                disabled={disabled || isFetchingCurrent}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className='p-1.5!'
              >
                {isFetchingCurrent ? (
                  <Loader className='size-3' animate />
                ) : showPassword ? (
                  <EyeOff className='size-3' />
                ) : (
                  <Eye className='size-3' />
                )}
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>
              <span>{showPassword ? 'Hide' : 'Show'}</span>
            </Tooltip.Content>
          </Tooltip.Root>
        </div>
      }
    />
  )
}
