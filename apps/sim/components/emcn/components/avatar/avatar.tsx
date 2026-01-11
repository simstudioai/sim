'use client'

import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/core/utils/cn'

/**
 * Variant styles for the Avatar component.
 * Supports multiple sizes for different use cases.
 */
const avatarVariants = cva('relative flex shrink-0 overflow-hidden rounded-full', {
  variants: {
    size: {
      xs: 'h-3.5 w-3.5',
      sm: 'h-6 w-6',
      md: 'h-8 w-8',
      lg: 'h-10 w-10',
    },
  },
  defaultVariants: {
    size: 'md',
  },
})

/**
 * Variant styles for the status indicator.
 */
const avatarStatusVariants = cva(
  'absolute bottom-0 right-0 rounded-full border-2 border-[var(--bg)]',
  {
    variants: {
      status: {
        online: 'bg-[#16a34a]',
        offline: 'bg-[var(--text-muted)]',
        busy: 'bg-[#dc2626]',
        away: 'bg-[#f59e0b]',
      },
      size: {
        xs: 'h-1.5 w-1.5 border',
        sm: 'h-2 w-2',
        md: 'h-2.5 w-2.5',
        lg: 'h-3 w-3',
      },
    },
    defaultVariants: {
      status: 'online',
      size: 'md',
    },
  }
)

type AvatarStatus = 'online' | 'offline' | 'busy' | 'away'

export interface AvatarProps
  extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>,
    VariantProps<typeof avatarVariants> {
  /** Shows a status indicator badge on the avatar */
  status?: AvatarStatus
}

/**
 * Avatar component for displaying user profile images with fallback support.
 *
 * @example
 * ```tsx
 * import { Avatar, AvatarImage, AvatarFallback } from '@/components/emcn'
 *
 * // Basic usage
 * <Avatar>
 *   <AvatarImage src="/avatar.jpg" alt="User" />
 *   <AvatarFallback>JD</AvatarFallback>
 * </Avatar>
 *
 * // With size variant
 * <Avatar size="lg">
 *   <AvatarImage src="/avatar.jpg" alt="User" />
 *   <AvatarFallback>JD</AvatarFallback>
 * </Avatar>
 *
 * // With status indicator
 * <Avatar status="online">
 *   <AvatarImage src="/avatar.jpg" alt="User" />
 *   <AvatarFallback>JD</AvatarFallback>
 * </Avatar>
 *
 * // All status types
 * <Avatar status="online" />   // Green
 * <Avatar status="offline" />  // Gray
 * <Avatar status="busy" />     // Red
 * <Avatar status="away" />     // Yellow/Amber
 * ```
 */
const Avatar = React.forwardRef<React.ElementRef<typeof AvatarPrimitive.Root>, AvatarProps>(
  ({ className, size, status, children, ...props }, ref) => (
    <div className='relative inline-flex'>
      <AvatarPrimitive.Root
        ref={ref}
        className={cn(avatarVariants({ size }), className)}
        {...props}
      >
        {children}
      </AvatarPrimitive.Root>
      {status && (
        <span
          data-slot='avatar-status'
          className={cn(avatarStatusVariants({ status, size }))}
          aria-label={`Status: ${status}`}
        />
      )}
    </div>
  )
)
Avatar.displayName = 'Avatar'

/**
 * Image component for Avatar. Renders the user's profile picture.
 */
const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn('aspect-square h-full w-full object-cover object-center', className)}
    {...props}
  />
))
AvatarImage.displayName = 'AvatarImage'

/**
 * Fallback component for Avatar. Displays initials or icon when image is unavailable.
 */
const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      'flex h-full w-full items-center justify-center rounded-full border border-[var(--border-1)] bg-[var(--surface-4)] font-medium text-[var(--text-secondary)] text-xs',
      className
    )}
    {...props}
  />
))
AvatarFallback.displayName = 'AvatarFallback'

export { Avatar, AvatarImage, AvatarFallback, avatarVariants, avatarStatusVariants }
