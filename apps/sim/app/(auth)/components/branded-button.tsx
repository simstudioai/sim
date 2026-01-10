'use client'

import { forwardRef, useState } from 'react'
import { ArrowRight, ChevronRight, Loader2 } from 'lucide-react'
import { Button, type ButtonProps as EmcnButtonProps } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { useBrandedButtonClass } from '@/hooks/use-branded-button-class'

export interface BrandedButtonProps extends Omit<EmcnButtonProps, 'variant' | 'size'> {
  /** Shows loading spinner and disables button */
  loading?: boolean
  /** Text to show when loading (appends "..." automatically) */
  loadingText?: string
  /** Show arrow animation on hover (default: true) */
  showArrow?: boolean
  /** Make button full width (default: true) */
  fullWidth?: boolean
}

/**
 * Branded button for auth and status pages.
 * Automatically detects whitelabel customization and applies appropriate styling.
 *
 * @example
 * ```tsx
 * // Primary branded button with arrow
 * <BrandedButton onClick={handleSubmit}>Sign In</BrandedButton>
 *
 * // Loading state
 * <BrandedButton loading loadingText="Signing in">Sign In</BrandedButton>
 *
 * // Without arrow animation
 * <BrandedButton showArrow={false}>Continue</BrandedButton>
 * ```
 */
export const BrandedButton = forwardRef<HTMLButtonElement, BrandedButtonProps>(
  (
    {
      children,
      loading = false,
      loadingText,
      showArrow = true,
      fullWidth = true,
      className,
      disabled,
      onMouseEnter,
      onMouseLeave,
      ...props
    },
    ref
  ) => {
    const buttonClass = useBrandedButtonClass()
    const [isHovered, setIsHovered] = useState(false)

    const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
      setIsHovered(true)
      onMouseEnter?.(e)
    }

    const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
      setIsHovered(false)
      onMouseLeave?.(e)
    }

    return (
      <Button
        ref={ref}
        variant='branded'
        size='branded'
        disabled={disabled || loading}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={cn(buttonClass, 'group', fullWidth && 'w-full', className)}
        {...props}
      >
        {loading ? (
          <span className='flex items-center gap-2'>
            <Loader2 className='h-4 w-4 animate-spin' />
            {loadingText ? `${loadingText}...` : children}
          </span>
        ) : showArrow ? (
          <span className='flex items-center gap-1'>
            {children}
            <span className='inline-flex transition-transform duration-200 group-hover:translate-x-0.5'>
              {isHovered ? (
                <ArrowRight className='h-4 w-4' aria-hidden='true' />
              ) : (
                <ChevronRight className='h-4 w-4' aria-hidden='true' />
              )}
            </span>
          </span>
        ) : (
          children
        )}
      </Button>
    )
  }
)

BrandedButton.displayName = 'BrandedButton'
