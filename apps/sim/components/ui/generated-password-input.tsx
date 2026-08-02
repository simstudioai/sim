'use client'

import { useEffect, useState } from 'react'
import { Button, ChipInput, Loader, Tooltip } from '@sim/emcn'
import { Check, Clipboard, Eye, EyeOff, RefreshCw } from 'lucide-react'
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
  const [copySuccess, setCopySuccess] = useState(false)
  const [currentPassword, setCurrentPassword] = useState<string | null>(null)
  const [isFetchingCurrent, setIsFetchingCurrent] = useState(false)

  useEffect(() => {
    if (!copySuccess) return
    const timer = setTimeout(() => setCopySuccess(false), 2000)
    return () => clearTimeout(timer)
  }, [copySuccess])

  const displayValue = currentPassword ?? value
  const displayPlaceholder = fetchCurrentPassword && !displayValue ? MASKED_PASSWORD : placeholder

  const copyToClipboard = () => {
    navigator.clipboard.writeText(displayValue)
    setCopySuccess(true)
  }

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
                  className='!p-1.5'
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
                onClick={copyToClipboard}
                disabled={!displayValue || disabled}
                aria-label='Copy password'
                className='!p-1.5'
              >
                {copySuccess ? <Check className='size-3' /> : <Clipboard className='size-3' />}
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>
              <span>{copySuccess ? 'Copied' : 'Copy'}</span>
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
                className='!p-1.5'
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
