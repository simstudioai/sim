'use client'

import * as React from 'react'
import { ChipInput, type ChipInputProps } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { AUTH_CONTROL_HEIGHT } from '@/app/(auth)/components/constants'

/**
 * The auth text field — a {@link ChipInput} raised to the auth control height
 * ({@link AUTH_CONTROL_HEIGHT}) so every labeled field on the auth and invite
 * surfaces shares one slightly-taller geometry. All chip props pass through
 * (`error`, `endAdornment`, `icon`, …); only the height is owned here, and a
 * caller's `className` (layout only) still composes on top.
 */
export const AuthInput = React.forwardRef<HTMLInputElement, ChipInputProps>(
  ({ className, ...props }, ref) => (
    <ChipInput ref={ref} className={cn(AUTH_CONTROL_HEIGHT, className)} {...props} />
  )
)

AuthInput.displayName = 'AuthInput'
