'use client'

import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const avatarStatusVariants = cva(
  'flex items-center rounded-full size-2 border-2 border-background',
  {
    variants: {
      variant: {
        online: 'bg-green-600',
        offline: 'bg-zinc-600 dark:bg-zinc-300',
        busy: 'bg-yellow-600',
        away: 'bg-blue-600',
      },
    },
    defaultVariants: {
      variant: 'online',
    },
  }
)

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn('relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full', className)}
    {...props}
  />
))
Avatar.displayName = AvatarPrimitive.Root.displayName

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
AvatarImage.displayName = AvatarPrimitive.Image.displayName

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      'flex h-full w-full items-center justify-center rounded-full border border-border bg-accent text-accent-foreground text-xs',
      className
    )}
    {...props}
  />
))
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

function AvatarIndicator({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot='avatar-indicator'
      className={cn('absolute flex size-6 items-center justify-center', className)}
      {...props}
    />
  )
}

function AvatarStatus({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof avatarStatusVariants>) {
  return (
    <div
      data-slot='avatar-status'
      className={cn(avatarStatusVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback, AvatarIndicator, AvatarStatus, avatarStatusVariants }
