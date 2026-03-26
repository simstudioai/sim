'use client'

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/core/utils/cn'

/**
 * Tooltip provider component that must wrap your app or tooltip usage area.
 */
const Provider = ({
  delayDuration = 400,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>) => (
  <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />
)

/**
 * Root tooltip component that wraps trigger and content.
 */
const Root = TooltipPrimitive.Root

/**
 * Trigger element that activates the tooltip on hover.
 */
const Trigger = TooltipPrimitive.Trigger

/**
 * Tooltip content component with consistent styling.
 *
 * @example
 * ```tsx
 * <Tooltip.Root>
 *   <Tooltip.Trigger asChild>
 *     <Button>Hover me</Button>
 *   </Tooltip.Trigger>
 *   <Tooltip.Content>
 *     <p>Tooltip text</p>
 *   </Tooltip.Content>
 * </Tooltip.Root>
 * ```
 */
const Content = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={8}
      avoidCollisions={true}
      className={cn(
        'z-[10000300] max-w-[260px] rounded-[4px] bg-[#1b1b1b] px-[8px] py-[3.5px] font-base text-white text-xs shadow-sm dark:bg-[#fdfdfd] dark:text-black',
        className
      )}
      {...props}
    >
      {props.children}
      <TooltipPrimitive.Arrow className='fill-[#1b1b1b] dark:fill-[#fdfdfd]' />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
))
Content.displayName = TooltipPrimitive.Content.displayName

interface ShortcutProps {
  /** The keyboard shortcut keys to display (e.g., "⌘D", "⌘K") */
  keys: string
  /** Optional additional class names */
  className?: string
  /** Optional children to display before the shortcut */
  children?: React.ReactNode
}

/**
 * Displays a keyboard shortcut within tooltip content.
 *
 * @example
 * ```tsx
 * <Tooltip.Content>
 *   <Tooltip.Shortcut keys="⌘D">Clear console</Tooltip.Shortcut>
 * </Tooltip.Content>
 * ```
 */
const Shortcut = ({ keys, className, children }: ShortcutProps) => (
  <span className={cn('flex items-center gap-[8px]', className)}>
    {children && <span>{children}</span>}
    <span className='opacity-70'>{keys}</span>
  </span>
)
Shortcut.displayName = 'Tooltip.Shortcut'

interface PreviewProps {
  /** The URL of the image, GIF, or video to display */
  src: string
  /** Alt text for the media */
  alt?: string
  /** Width of the preview in pixels */
  width?: number
  /** Height of the preview in pixels */
  height?: number
  /** Whether video should loop */
  loop?: boolean
  /** Optional additional class names */
  className?: string
}

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg', '.mov'] as const

/**
 * Displays a preview image, GIF, or video within tooltip content.
 *
 * @example
 * ```tsx
 * <Tooltip.Content>
 *   <p>Canvas error notifications</p>
 *   <Tooltip.Preview src="/tooltips/canvas-error-notification.mp4" alt="Error notification example" />
 * </Tooltip.Content>
 * ```
 */
const Preview = ({ src, alt = '', width = 240, height, loop = true, className }: PreviewProps) => {
  const pathname = src.toLowerCase().split('?')[0].split('#')[0]
  const isVideo = VIDEO_EXTENSIONS.some((ext) => pathname.endsWith(ext))

  return (
    <div
      className={cn('-mx-[8px] -mb-[3.5px] mt-[4px] overflow-hidden rounded-b-[4px]', className)}
    >
      {isVideo ? (
        <video
          src={src}
          width={width}
          height={height}
          className='block w-full'
          autoPlay
          loop={loop}
          muted
          playsInline
          preload='none'
          aria-label={alt}
        />
      ) : (
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          className='block w-full'
          loading='lazy'
        />
      )}
    </div>
  )
}
Preview.displayName = 'Tooltip.Preview'

export const Tooltip = {
  Root,
  Trigger,
  Content,
  Provider,
  Shortcut,
  Preview,
}
