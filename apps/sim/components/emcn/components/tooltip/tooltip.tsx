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
>(({ className, sideOffset = 6, children, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={8}
      avoidCollisions
      className={cn(
        'z-[var(--z-tooltip)] max-w-[260px] rounded-[4px] bg-[var(--tooltip-bg)] px-2 py-[3.5px] font-base text-white text-xs shadow-sm dark:text-black',
        className
      )}
      {...props}
    >
      {children}
      <TooltipPrimitive.Arrow className='fill-[var(--tooltip-bg)]' />
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
  <span className={cn('flex items-center gap-2', className)}>
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
  const [isReady, setIsReady] = React.useState(!isVideo)

  return (
    <div className={cn('-mx-[6px] -mb-[1.5px] mt-1.5 overflow-hidden rounded-[4px]', className)}>
      {isVideo ? (
        <div className='relative'>
          {!isReady && (
            <div
              className='animate-pulse bg-white/5'
              style={{ aspectRatio: height ? `${width}/${height}` : '16/9' }}
            />
          )}
          <video
            src={src}
            width={width}
            height={height}
            className={cn(
              'block w-full transition-opacity duration-200',
              isReady ? 'opacity-100' : 'absolute inset-0 opacity-0'
            )}
            autoPlay
            loop={loop}
            muted
            playsInline
            preload='auto'
            aria-label={alt}
            onCanPlay={() => setIsReady(true)}
          />
        </div>
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
