'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import {
  FloatingTooltip,
  type FloatingTooltipHandlers,
  type FloatingTooltipState,
  useFloatingTooltip,
} from '@/components/emcn/components/tooltip/floating-tooltip'
import { cn } from '@/lib/core/utils/cn'

/**
 * Kept for API compatibility with the previous tooltip. The floating tooltip has no shared hover
 * delay, so this is a passthrough — props are accepted but unused.
 */
const Provider = ({
  children,
}: {
  children: React.ReactNode
  delayDuration?: number
  skipDelayDuration?: number
  disableHoverableContent?: boolean
}) => <>{children}</>
Provider.displayName = 'Tooltip.Provider'

const ALWAYS_SHOW = () => true

interface TooltipContextValue {
  state: FloatingTooltipState
  handlers: FloatingTooltipHandlers
  contentId: string
}

const TooltipContext = React.createContext<TooltipContextValue | null>(null)

function useTooltipContext(component: string): TooltipContextValue {
  const context = React.useContext(TooltipContext)
  if (!context) {
    throw new Error(`Tooltip.${component} must be rendered within a Tooltip.Root`)
  }
  return context
}

interface RootProps {
  children: React.ReactNode
  /** Accepted for API compatibility; the floating tooltip has no hover delay. */
  delayDuration?: number
}

/**
 * Root of a single tooltip. Coordinates a cursor-following floating bubble between its `Trigger`
 * and `Content`.
 *
 * @example
 * ```tsx
 * <Tooltip.Root>
 *   <Tooltip.Trigger asChild>
 *     <Button>Hover me</Button>
 *   </Tooltip.Trigger>
 *   <Tooltip.Content>Tooltip text</Tooltip.Content>
 * </Tooltip.Root>
 * ```
 */
function Root({ children }: RootProps) {
  const contentId = React.useId()
  const { state, handlers } = useFloatingTooltip(ALWAYS_SHOW)
  const value = React.useMemo<TooltipContextValue>(
    () => ({ state, handlers, contentId }),
    [state, handlers, contentId]
  )
  return <TooltipContext.Provider value={value}>{children}</TooltipContext.Provider>
}
Root.displayName = 'Tooltip.Root'

function composeHandlers<E extends React.SyntheticEvent>(
  theirHandler: ((event: E) => void) | undefined,
  ourHandler: (event: E) => void
) {
  return (event: E) => {
    theirHandler?.(event)
    if (!event.defaultPrevented) ourHandler(event)
  }
}

interface TriggerProps extends React.ComponentPropsWithoutRef<'button'> {
  /** Merge tooltip behavior onto the single child element instead of rendering a button. */
  asChild?: boolean
}

/**
 * Element that activates the tooltip on hover/focus. Use `asChild` to project onto your own element.
 */
const Trigger = React.forwardRef<HTMLButtonElement, TriggerProps>(
  ({ asChild = false, ...props }, ref) => {
    const ctx = useTooltipContext('Trigger')
    const Comp = asChild ? Slot : 'button'

    return (
      <Comp
        ref={ref as React.Ref<HTMLButtonElement>}
        aria-describedby={ctx.state.visible ? ctx.contentId : undefined}
        {...props}
        onPointerEnter={composeHandlers(props.onPointerEnter, (event) =>
          ctx.handlers.onPointerEnter(event)
        )}
        onPointerMove={composeHandlers(props.onPointerMove, (event) =>
          ctx.handlers.onPointerMove(event)
        )}
        onPointerLeave={composeHandlers(props.onPointerLeave, () => ctx.handlers.onPointerLeave())}
        onPointerDown={composeHandlers(props.onPointerDown, () => ctx.handlers.onPointerDown())}
        onFocus={composeHandlers(props.onFocus, (event) => ctx.handlers.onFocus(event))}
        onBlur={composeHandlers(props.onBlur, () => ctx.handlers.onBlur())}
      />
    )
  }
)
Trigger.displayName = 'Tooltip.Trigger'

interface ContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Legacy positioning props from the previous Radix tooltip. Accepted for drop-in compatibility
   * but ignored — the tooltip now follows the cursor.
   */
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  align?: 'start' | 'center' | 'end'
  alignOffset?: number
  avoidCollisions?: boolean
  collisionPadding?: number | Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>
  collisionBoundary?: unknown
  arrowPadding?: number
  sticky?: 'partial' | 'always'
  hideWhenDetached?: boolean
  asChild?: boolean
  forceMount?: boolean
}

/**
 * Tooltip content, rendered in a cursor-following floating bubble.
 *
 * @example
 * ```tsx
 * <Tooltip.Content>
 *   <p>Tooltip text</p>
 * </Tooltip.Content>
 * ```
 */
function Content({ className, children }: ContentProps) {
  const ctx = useTooltipContext('Content')
  return (
    <FloatingTooltip state={ctx.state} role='tooltip' id={ctx.contentId} className={className}>
      {children}
    </FloatingTooltip>
  )
}
Content.displayName = 'Tooltip.Content'

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
