'use client'

import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

/**
 * Variant styles for the Avatar component.
 * Supports multiple sizes for different use cases.
 */
const avatarVariants = cva('relative flex shrink-0 overflow-hidden rounded-full', {
  variants: {
    size: {
      xs: 'size-3.5',
      sm: 'size-6',
      md: 'size-8',
      lg: 'size-10',
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
        online: 'bg-[var(--success)]',
        offline: 'bg-[var(--text-muted)]',
        busy: 'bg-[var(--error)]',
        away: 'bg-[var(--caution)]',
      },
      size: {
        xs: 'size-1.5 border',
        sm: 'size-2',
        md: 'size-2.5',
        lg: 'size-3',
      },
    },
    defaultVariants: {
      status: 'online',
      size: 'md',
    },
  }
)

/**
 * Variant styles for the fallback, keyed by the enclosing avatar's size. `xs` is a
 * 14px disc, where `text-xs` would overflow the border, so its glyph steps down and
 * drops the inherited line height that would push it off-center.
 */
const avatarFallbackVariants = cva(
  'flex size-full items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-4)] font-medium text-[var(--text-secondary)]',
  {
    variants: {
      size: {
        xs: 'text-[8px] leading-none',
        sm: 'text-xs',
        md: 'text-xs',
        lg: 'text-xs',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  }
)

type AvatarSize = VariantProps<typeof avatarVariants>['size']

/** Lets `AvatarFallback` size its glyph to the avatar it sits in. */
const AvatarSizeContext = React.createContext<AvatarSize>(undefined)

type AvatarStatus = 'online' | 'offline' | 'busy' | 'away'

interface AvatarBaseProps
  extends Omit<React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>, 'children'>,
    VariantProps<typeof avatarVariants> {
  /** Shows a status indicator badge on the avatar */
  status?: AvatarStatus
}

/**
 * Either a person — `name`, and optionally `src` — or composed `children`. The two
 * never mix: a composed avatar owns its own image and label.
 */
type AvatarProps = AvatarBaseProps &
  (
    | {
        /**
         * A person's name, used as the accessible label (with any `status`) — pass
         * `aria-hidden` where the name is already visible beside it. The avatar renders
         * `src` with the name's initial as its fallback.
         */
        name: string
        /** Photo for the person; the initial shows while it loads, or if it fails. */
        src?: string | null
        children?: never
      }
    | { name?: never; src?: never; children?: React.ReactNode }
  )

/**
 * Avatar component for displaying user profile images with fallback support.
 *
 * @example
 * ```tsx
 * import { Avatar, AvatarImage, AvatarFallback } from '@sim/emcn'
 *
 * // A person: their photo, falling back to their initial
 * <Avatar size="xs" name="Ada Lovelace" src={user.image} />
 *
 * // Composed, for a custom fallback
 * <Avatar size="lg">
 *   <AvatarImage src="/avatar.jpg" alt="User" />
 *   <AvatarFallback>JD</AvatarFallback>
 * </Avatar>
 *
 * // With status indicator
 * <Avatar status="online" name="Ada Lovelace" />
 * ```
 */
const Avatar = React.forwardRef<React.ElementRef<typeof AvatarPrimitive.Root>, AvatarProps>(
  ({ className, size, status, name, src, children, ...props }, ref) => {
    const hidden = props['aria-hidden'] === true || props['aria-hidden'] === 'true'
    const label = name?.trim()
    const labelled = Boolean(label) && !hidden
    return (
      <AvatarSizeContext.Provider value={size}>
        <div className='relative inline-flex'>
          <AvatarPrimitive.Root
            ref={ref}
            className={cn(avatarVariants({ size }), className)}
            {...(labelled
              ? { role: 'img', 'aria-label': status ? `${label}, ${status}` : label }
              : {})}
            {...props}
          >
            {name === undefined ? (
              children
            ) : (
              <>
                {src && <AvatarImage src={src} alt='' referrerPolicy='no-referrer' />}
                <AvatarFallback>{label?.charAt(0).toUpperCase() || '?'}</AvatarFallback>
              </>
            )}
          </AvatarPrimitive.Root>
          {/**
           * A named avatar carries its status in its own label, and a hidden one
           * carries nothing; only a composed avatar announces the dot itself.
           */}
          {status && (
            <span
              data-slot='avatar-status'
              className={cn(avatarStatusVariants({ status, size }))}
              {...(labelled || hidden
                ? { 'aria-hidden': true }
                : { role: 'img', 'aria-label': `Status: ${status}` })}
            />
          )}
        </div>
      </AvatarSizeContext.Provider>
    )
  }
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
    className={cn(
      '-outline-offset-1 aspect-square size-full object-cover object-center outline outline-1 outline-black/5',
      className
    )}
    {...props}
  />
))
AvatarImage.displayName = 'AvatarImage'

/**
 * Fallback component for Avatar. Displays initials or icon when image is unavailable.
 * Its glyph size follows the enclosing avatar's `size`.
 *
 * Carries the package's only hardcoded `font-medium`, and deliberately: one or
 * two capitals on a filled disc are a glyph, not running text, and need the
 * extra mass to read at avatar sizes. This is the sanctioned "step up from
 * body" — every other primitive inherits the document 400.
 */
const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => {
  const size = React.useContext(AvatarSizeContext)
  return (
    <AvatarPrimitive.Fallback
      ref={ref}
      className={cn(avatarFallbackVariants({ size }), className)}
      {...props}
    />
  )
})
AvatarFallback.displayName = 'AvatarFallback'

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  avatarVariants,
  avatarStatusVariants,
  avatarFallbackVariants,
}
