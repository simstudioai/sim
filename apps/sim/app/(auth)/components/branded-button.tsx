'use client'

import { forwardRef, useState } from 'react'
import { ArrowRight, ChevronRight, Loader2 } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'
import { useBrandConfig } from '@/ee/whitelabeling'

export interface BrandedButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean
  loadingText?: string
  showArrow?: boolean
  fullWidth?: boolean
}

/**
 * Branded button for auth and status pages.
 * Default: white button matching the landing page "Get started" style.
 * Whitelabel: uses the brand's primary color as background with white text.
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
    const brand = useBrandConfig()
    const hasCustomColor = brand.isWhitelabeled && Boolean(brand.theme?.primaryColor)
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
      <button
        ref={ref}
        {...props}
        disabled={disabled || loading}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={cn(
          'group inline-flex h-[32px] items-center justify-center gap-[8px] rounded-[5px] border px-[10px] font-[430] font-season text-[14px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          !hasCustomColor &&
            'border-[#FFFFFF] bg-[#FFFFFF] text-black hover:border-[#E0E0E0] hover:bg-[#E0E0E0]',
          fullWidth && 'w-full',
          className
        )}
        style={
          hasCustomColor
            ? {
                backgroundColor: isHovered
                  ? (brand.theme?.primaryHoverColor ?? brand.theme?.primaryColor)
                  : brand.theme?.primaryColor,
                borderColor: isHovered
                  ? (brand.theme?.primaryHoverColor ?? brand.theme?.primaryColor)
                  : brand.theme?.primaryColor,
                color: '#FFFFFF',
              }
            : undefined
        }
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
      </button>
    )
  }
)

BrandedButton.displayName = 'BrandedButton'
