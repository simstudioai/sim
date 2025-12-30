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
      xs: 'h-6 w-6',
      sm: 'h-8 w-8',
      md: 'h-10 w-10',
      lg: 'h-12 w-12',
      xl: 'h-16 w-16',
    },
  },
  defaultVariants: {
    size: 'md',
  },
})

/**
 * Variant styles for the AvatarStatus indicator.
 * Shows online/offline/busy/away status.
 */
const avatarStatusVariants = cva(
  'flex items-center rounded-full border-2 border-[var(--surface-1)] transition-colors',
  {
    variants: {
      variant: {
        online: 'bg-[#16a34a]',
        offline: 'bg-[var(--text-muted)]',
        busy: 'bg-[#ca8a04]',
        away: 'bg-[#2563eb]',
      },
      size: {
        xs: 'h-1.5 w-1.5',
        sm: 'h-2 w-2',
        md: 'h-2.5 w-2.5',
        lg: 'h-3 w-3',
        xl: 'h-4 w-4',
      },
    },
    defaultVariants: {
      variant: 'online',
      size: 'md',
    },
  }
)

export interface AvatarProps
  extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>,
    VariantProps<typeof avatarVariants> {}

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
 * <Avatar>
 *   <AvatarImage src="/avatar.jpg" alt="User" />
 *   <AvatarFallback>JD</AvatarFallback>
 *   <AvatarIndicator className="bottom-0 right-0">
 *     <AvatarStatus variant="online" />
 *   </AvatarIndicator>
 * </Avatar>
 * ```
 */
const Avatar = React.forwardRef<React.ElementRef<typeof AvatarPrimitive.Root>, AvatarProps>(
  ({ className, size, ...props }, ref) => (
    <AvatarPrimitive.Root
      ref={ref}
      className={cn(avatarVariants({ size }), className)}
      {...props}
    />
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

/**
 * Container for positioning status indicators on the Avatar.
 */
function AvatarIndicator({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot='avatar-indicator'
      className={cn('absolute flex items-center justify-center', className)}
      {...props}
    />
  )
}
AvatarIndicator.displayName = 'AvatarIndicator'

export interface AvatarStatusProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof avatarStatusVariants> {}

/**
 * Status indicator component for Avatar.
 * Shows user's availability status (online, offline, busy, away).
 */
function AvatarStatus({ className, variant, size, ...props }: AvatarStatusProps) {
  return (
    <div
      data-slot='avatar-status'
      className={cn(avatarStatusVariants({ variant, size }), className)}
      {...props}
    />
  )
}
AvatarStatus.displayName = 'AvatarStatus'

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarIndicator,
  AvatarStatus,
  avatarVariants,
  avatarStatusVariants,
}
