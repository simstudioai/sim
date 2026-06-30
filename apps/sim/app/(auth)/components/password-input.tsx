'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { ChipInput, type ChipInputProps } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { AUTH_CONTROL_HEIGHT } from '@/app/(auth)/components/constants'

type PasswordInputProps = Omit<ChipInputProps, 'type' | 'icon' | 'endAdornment'>

/**
 * A {@link ChipInput} that owns the password reveal toggle — the eye button is
 * driven through the canonical `endAdornment` slot and the field's invalid state
 * through the `error` prop, so no consumer hand-rolls the relative wrapper +
 * absolutely positioned button the auth forms previously duplicated four times.
 */
export function PasswordInput({ error, className, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <ChipInput
      {...props}
      className={cn(AUTH_CONTROL_HEIGHT, className)}
      type={visible ? 'text' : 'password'}
      error={error}
      endAdornment={
        <button
          type='button'
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          className='flex shrink-0 text-[var(--text-icon)] transition-colors hover:text-[var(--text-primary)]'
        >
          {visible ? <EyeOff className='size-[14px]' /> : <Eye className='size-[14px]' />}
        </button>
      }
    />
  )
}
