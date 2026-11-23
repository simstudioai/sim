/**
 * Popover component system with built-in folder navigation and automatic viewport positioning.
 * Uses Radix UI primitives for collision detection and smart placement.
 *
 * @example
 * Basic usage with folders:
 * ```tsx
 * import { Popover, PopoverAnchor, PopoverContent, PopoverFolder, PopoverItem } from '../../index'
 * import { Workflow } from '@sim/emcn/icons'
 *
 * function MyMenu() {
 *   const [workflows, setWorkflows] = useState([])
 *   const [open, setOpen] = useState(false)
 *
 *   return (
 *     <Popover open={open} onOpenChange={setOpen}>
 *       <PopoverAnchor>
 *         <button>Open Menu</button>
 *       </PopoverAnchor>
 *       <PopoverContent>
 *         <PopoverItem rootOnly onClick={() => console.log('Docs')}>
 *           <BookOpen className="size-3.5" />
 *           <span>Docs</span>
 *         </PopoverItem>
 *
 *         <PopoverFolder
 *           id="workflows"
 *           title="All workflows"
 *           icon={<Workflow className="size-3.5" />}
 *           onOpen={async () => {
 *             const data = await fetchWorkflows()
 *             setWorkflows(data)
 *           }}
 *         >
 *           {workflows.map(wf => (
 *             <PopoverItem key={wf.id} onClick={() => selectWorkflow(wf)}>
 *               <Workflow className="size-[14px] text-[var(--text-icon)]" />
 *               <span>{wf.name}</span>
 *             </PopoverItem>
 *           ))}
 *         </PopoverFolder>
 *       </PopoverContent>
 *     </Popover>
 *   )
 * }
 * ```
 */

'use client'

import * as React from 'react'
import { DismissableLayerBranch } from '@radix-ui/react-dismissable-layer'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { createPortal } from 'react-dom'
import { MENU_STYLES } from '#menu-styles'
import { Check, ChevronRight } from '../../icons'
import { cn } from '../../lib/cn'
import { chipActiveSurfaceClass, chipHoverSurfaceClass } from '../chip/chrome'
import { InsideModalContext } from '../modal/modal'
import { TOOLTIP_MAX_WIDTH_PX, TOOLTIP_SURFACE_CLASS } from '../tooltip/styles'

type PopoverSize = 'sm' | 'md'
type PopoverColorScheme = 'default' | 'inverted'

/**
 * Style constants for popover components.
 * Organized by component type and property.
 */
const STYLES = {
  /** Base classes shared by all interactive items */
  itemBase: `${MENU_STYLES.rowLayout} cursor-pointer disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed`,

  /** Content container */
  content: `${MENU_STYLES.surface} ${MENU_STYLES.padding}`,

  /** Size variants */
  size: {
    sm: { item: MENU_STYLES.sizes.sm.className, icon: 'size-3', section: MENU_STYLES.heading },
    md: {
      item: MENU_STYLES.sizes.md.className,
      icon: 'size-[14px]',
      section: MENU_STYLES.heading,
    },
  } satisfies Record<PopoverSize, { item: string; icon: string; section: string }>,

  /** Color scheme variants */
  colorScheme: {
    default: {
      text: 'text-[var(--text-body)] [&_svg]:text-[var(--text-icon)]',
      section: 'text-[var(--text-muted)]',
      content: '',
      divider: 'border-[var(--border)]',
    },
    inverted: {
      text: 'text-white dark:text-[var(--text-primary)]',
      section: 'text-[var(--text-muted-inverse)]',
      content:
        'border-[var(--border-inverted)] bg-[var(--surface-inverted)] text-white dark:text-foreground',
      divider: 'border-[var(--border-inverted)]',
    },
  } satisfies Record<
    PopoverColorScheme,
    {
      text: string
      section: string
      content: string
      divider: string
    }
  >,

  /** Interactive state styles: default, and inverted (dark bg in light mode) */
  states: {
    default: {
      /**
       * The shared row-state pair — see {@link chipHoverSurfaceClass}.
       * `getItemStateClasses` returns active OR hover and never both, which is
       * what holds a checked item's surface through hover.
       */
      active: chipActiveSurfaceClass,
      hover: chipHoverSurfaceClass,
    },
    inverted: {
      active:
        'bg-[var(--surface-inverted-hover)] text-white [&_svg]:text-white dark:text-[var(--text-primary)] dark:[&_svg]:text-[var(--text-primary)]',
      hover:
        'hover-hover:bg-[var(--surface-inverted-hover)] hover-hover:text-white hover-hover:[&_svg]:text-white dark:hover-hover:text-[var(--text-primary)] dark:hover-hover:[&_svg]:text-[var(--text-primary)]',
    },
  },
} as const

/** Gets the active/hover classes for a popover item, keyed by colour scheme. */
function getItemStateClasses(colorScheme: PopoverColorScheme, isActive: boolean): string {
  const state = isActive ? 'active' : 'hover'
  return colorScheme === 'inverted' ? STYLES.states.inverted[state] : STYLES.states.default[state]
}

interface PopoverContextValue {
  openFolder: (id: string, onLoad?: () => void | Promise<void>) => void
  closeFolder: () => void
  currentFolder: string | null
  isInFolder: boolean
  size: PopoverSize
  colorScheme: PopoverColorScheme
  /** ID of the last hovered item (for hover submenus) */
  lastHoveredItem: string | null
  setLastHoveredItem: (id: string | null) => void
  /** Whether keyboard navigation is active. When true, hover styles are suppressed. */
  isKeyboardNav: boolean
  setKeyboardNav: (value: boolean) => void
  /** Currently selected item index for keyboard navigation */
  selectedIndex: number
  setSelectedIndex: (index: number) => void
}

const PopoverContext = React.createContext<PopoverContextValue | null>(null)

const usePopoverContext = () => {
  const context = React.useContext(PopoverContext)
  if (!context) {
    throw new Error('Popover components must be used within a Popover')
  }
  return context
}

interface PopoverProps extends PopoverPrimitive.PopoverProps {
  /**
   * Size variant of the popover
   * - sm: 12px text, compact spacing (for logs, notifications, context menus)
   * - md: 13px text, default spacing
   * @default 'md'
   */
  size?: PopoverSize
  /**
   * Color scheme for the popover
   * - default: light background in light mode, dark in dark mode
   * - inverted: dark background (#1b1b1b) in light mode, matches tooltip styling
   * @default 'default'
   */
  colorScheme?: PopoverColorScheme
}

/**
 * Root popover component. Manages open state and folder navigation context.
 */
const Popover: React.FC<PopoverProps> = ({
  children,
  size = 'md',
  colorScheme = 'default',
  open,
  onOpenChange,
  modal,
  ...props
}) => {
  const insideModal = React.useContext(InsideModalContext)
  const [currentFolder, setCurrentFolder] = React.useState<string | null>(null)
  const [lastHoveredItem, setLastHoveredItem] = React.useState<string | null>(null)
  const [isKeyboardNav, setIsKeyboardNav] = React.useState(false)
  const [selectedIndex, setSelectedIndex] = React.useState(-1)

  /** Resets all navigation state to initial values */
  const resetState = React.useCallback(() => {
    setCurrentFolder(null)
    setLastHoveredItem(null)
    setIsKeyboardNav(false)
    setSelectedIndex(-1)
  }, [])

  React.useEffect(() => {
    if (!open) {
      resetState()
    }
  }, [open, resetState])

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        setLastHoveredItem(null)
      }
      onOpenChange?.(nextOpen)
    },
    [onOpenChange]
  )

  const openFolder = React.useCallback((id: string, onLoad?: () => void | Promise<void>) => {
    setCurrentFolder(id)
    if (onLoad) {
      void Promise.resolve(onLoad())
    }
  }, [])

  const closeFolder = React.useCallback(() => {
    setCurrentFolder(null)
  }, [])

  const setKeyboardNav = React.useCallback((value: boolean) => {
    setIsKeyboardNav(value)
  }, [])

  const contextValue = React.useMemo<PopoverContextValue>(
    () => ({
      openFolder,
      closeFolder,
      currentFolder,
      isInFolder: currentFolder !== null,
      size,
      colorScheme,
      lastHoveredItem,
      setLastHoveredItem,
      isKeyboardNav,
      setKeyboardNav,
      selectedIndex,
      setSelectedIndex,
    }),
    [
      openFolder,
      closeFolder,
      currentFolder,
      size,
      colorScheme,
      lastHoveredItem,
      isKeyboardNav,
      setKeyboardNav,
      selectedIndex,
    ]
  )

  return (
    <PopoverContext.Provider value={contextValue}>
      <PopoverPrimitive.Root
        open={open}
        onOpenChange={handleOpenChange}
        modal={insideModal ? true : modal}
        {...props}
      >
        {children}
      </PopoverPrimitive.Root>
    </PopoverContext.Provider>
  )
}

Popover.displayName = 'Popover'

/**
 * Trigger element that opens/closes the popover when clicked.
 * Use asChild to render as a custom component.
 */
const PopoverTrigger = PopoverPrimitive.Trigger

/**
 * Anchor element for the popover. Can be a virtual element or React element.
 * For positioning popovers relative to cursor/caret, use asChild with a positioned element.
 */
const PopoverAnchor = PopoverPrimitive.Anchor

interface PopoverContentProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>,
    'side' | 'align' | 'sideOffset' | 'alignOffset' | 'collisionPadding'
  > {
  /**
   * Renders content inline instead of in a portal.
   * Useful inside dialogs where portals interfere with scroll locking.
   * @default false
   */
  disablePortal?: boolean
  /** Maximum height in pixels */
  maxHeight?: number
  /** Maximum width in pixels or as a CSS length. Enables text truncation when set. */
  maxWidth?: number | string
  /** Minimum width in pixels */
  minWidth?: number
  /**
   * Preferred side to display
   * @default 'bottom'
   */
  side?: 'top' | 'right' | 'bottom' | 'left'
  /**
   * Alignment relative to anchor
   * @default 'start'
   */
  align?: 'start' | 'center' | 'end'
  /** Offset from anchor. Defaults to 20px for top, 14px for other sides. */
  sideOffset?: number
  /**
   * Padding from viewport edges
   * @default 8
   */
  collisionPadding?: number
  /**
   * Adds border to content
   * @default true
   */
  border?: boolean
  /**
   * Applies a semantic platform surface treatment.
   * @default 'default'
   */
  appearance?: 'default' | 'tooltip'
  /**
   * Flip to avoid viewport collisions
   * @default true
   */
  avoidCollisions?: boolean
  /**
   * Show an arrow pointing toward the anchor element.
   * The arrow color matches the popover background based on the current color scheme.
   * @default false
   */
  showArrow?: boolean
  /**
   * Custom className for the arrow element.
   * Overrides the default color-scheme-based fill when provided.
   * Useful when the popover background is overridden via className.
   */
  arrowClassName?: string
}

/**
 * Popover content with automatic positioning and collision detection.
 */
const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(
  (
    {
      className,
      disablePortal = false,
      style,
      children,
      maxHeight,
      maxWidth,
      minWidth,
      side = 'bottom',
      align = 'start',
      sideOffset,
      collisionPadding = 8,
      border = true,
      appearance = 'default',
      avoidCollisions = true,
      showArrow = false,
      arrowClassName,
      onOpenAutoFocus,
      onCloseAutoFocus,
      ...restProps
    },
    ref
  ) => {
    const context = React.useContext(PopoverContext)
    const size = context?.size || 'md'
    const colorScheme = context?.colorScheme || 'default'

    const effectiveSideOffset = sideOffset ?? (side === 'top' ? 20 : 14)

    const handleMouseMove = React.useCallback(() => {
      if (context?.isKeyboardNav) {
        context.setKeyboardNav(false)
      }
    }, [context])

    const contentRef = React.useRef<HTMLDivElement>(null)

    const mergedRef = React.useCallback(
      (node: HTMLDivElement | null) => {
        contentRef.current = node
        if (typeof ref === 'function') {
          ref(node)
        } else if (ref) {
          ref.current = node
        }
      },
      [ref]
    )

    React.useEffect(() => {
      if (!context) return

      const handleKeyDown = (e: KeyboardEvent) => {
        const content = contentRef.current
        if (!content) return

        const activeElement = document.activeElement
        const isInputFocused =
          activeElement instanceof HTMLInputElement ||
          activeElement instanceof HTMLTextAreaElement ||
          activeElement?.getAttribute('contenteditable') === 'true'
        if (isInputFocused) return

        const items = content.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([aria-disabled="true"])'
        )
        if (items.length === 0) return

        const currentIndex = context.selectedIndex

        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault()
            e.stopPropagation()
            context.setKeyboardNav(true)
            if (currentIndex < 0) {
              context.setSelectedIndex(0)
            } else {
              context.setSelectedIndex(currentIndex < items.length - 1 ? currentIndex + 1 : 0)
            }
            break
          case 'ArrowUp':
            e.preventDefault()
            e.stopPropagation()
            context.setKeyboardNav(true)
            if (currentIndex < 0) {
              context.setSelectedIndex(items.length - 1)
            } else {
              context.setSelectedIndex(currentIndex > 0 ? currentIndex - 1 : items.length - 1)
            }
            break
          case 'Enter':
          case ' ':
            if (currentIndex >= 0) {
              e.preventDefault()
              e.stopPropagation()
              const selectedItem = items[currentIndex]
              if (selectedItem) {
                selectedItem.click()
              }
            }
            break
        }
      }

      window.addEventListener('keydown', handleKeyDown, true)
      return () => window.removeEventListener('keydown', handleKeyDown, true)
    }, [context])

    // Note: scrollIntoView for keyboard navigation is intentionally disabled here.
    // Components using Popover (like TagDropdown) should handle their own scroll
    // management to avoid conflicts between the popover's internal selection index
    // and the component's custom navigation state.

    const effectiveMaxWidth =
      maxWidth !== undefined
        ? typeof maxWidth === 'number'
          ? `${maxWidth}px`
          : maxWidth
        : appearance === 'tooltip'
          ? `min(${TOOLTIP_MAX_WIDTH_PX}px, calc(100vw - 2rem))`
          : undefined
    const hasUserWidthConstraint =
      effectiveMaxWidth !== undefined ||
      minWidth !== undefined ||
      style?.minWidth !== undefined ||
      style?.maxWidth !== undefined ||
      style?.width !== undefined

    const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
      const container = event.currentTarget
      if (!container) return

      const { scrollHeight, clientHeight, scrollTop } = container
      if (scrollHeight <= clientHeight) return

      const deltaY = event.deltaY
      const isScrollingDown = deltaY > 0
      const isAtTop = scrollTop === 0
      const isAtBottom = scrollTop + clientHeight >= scrollHeight

      if ((isScrollingDown && isAtBottom) || (!isScrollingDown && isAtTop)) return

      event.preventDefault()
      container.scrollTop += deltaY
    }

    const handleOpenAutoFocus = React.useCallback(
      (e: Event) => {
        e.preventDefault()
        onOpenAutoFocus?.(e)
      },
      [onOpenAutoFocus]
    )

    const handleCloseAutoFocus = React.useCallback(
      (e: Event) => {
        e.preventDefault()
        onCloseAutoFocus?.(e)
      },
      [onCloseAutoFocus]
    )

    const content = (
      <PopoverPrimitive.Content
        ref={mergedRef}
        side={side}
        align={align}
        sideOffset={effectiveSideOffset}
        collisionPadding={collisionPadding}
        avoidCollisions={avoidCollisions}
        sticky='partial'
        hideWhenDetached={false}
        onWheel={handleWheel}
        onMouseMove={handleMouseMove}
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={handleCloseAutoFocus}
        {...restProps}
        data-native-surface-overlay=''
        className={cn(
          'z-[var(--z-popover)] flex flex-col outline-hidden max-md:max-h-[min(var(--radix-popover-content-available-height),calc(100dvh-1rem))]! max-md:max-w-[calc(100vw-1rem)]!',
          showArrow ? 'overflow-visible' : 'overflow-auto',
          STYLES.content,
          STYLES.colorScheme[colorScheme].content,
          appearance === 'tooltip' && cn(TOOLTIP_SURFACE_CLASS, 'p-1.5'),
          hasUserWidthConstraint &&
            '[&_.flex-1:not([data-popover-scroll])]:truncate [&_[data-popover-section]]:truncate',
          !border && appearance !== 'tooltip' && 'border-0',
          className
        )}
        style={{
          maxHeight: `${maxHeight || 400}px`,
          maxWidth: effectiveMaxWidth ?? 'calc(100vw - 16px)',
          minWidth:
            minWidth !== undefined
              ? `${minWidth}px`
              : hasUserWidthConstraint
                ? undefined
                : size === 'sm'
                  ? '140px'
                  : '160px',
          ...style,
        }}
      >
        {showArrow ? (
          <div
            className='flex flex-1 flex-col overflow-auto'
            style={{ maxHeight: `${maxHeight || 400}px` }}
          >
            {children}
          </div>
        ) : (
          children
        )}
        {showArrow && (
          <PopoverPrimitive.Arrow width={14} height={7} asChild>
            <svg
              width={14}
              height={7}
              viewBox='0 0 14 7'
              preserveAspectRatio='none'
              className={
                arrowClassName ??
                cn(
                  colorScheme === 'inverted'
                    ? 'fill-[var(--surface-inverted)] stroke-[var(--border-inverted)]'
                    : 'fill-[var(--bg)] stroke-[var(--border)]'
                )
              }
            >
              <polygon points='0,0 14,0 7,7' className='stroke-none' />
              <polyline points='0,0 7,7 14,0' fill='none' strokeWidth={1} />
            </svg>
          </PopoverPrimitive.Arrow>
        )}
      </PopoverPrimitive.Content>
    )

    if (disablePortal) return content

    return <PopoverPrimitive.Portal>{content}</PopoverPrimitive.Portal>
  }
)

PopoverContent.displayName = 'PopoverContent'

interface PopoverScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * Scrollable container for popover items.
 */
const PopoverScrollArea = React.forwardRef<HTMLDivElement, PopoverScrollAreaProps>(
  ({ className, ...props }, ref) => (
    <div
      className={cn(
        'min-h-0 overflow-auto overscroll-contain',
        '[&>div:has([data-popover-section]):not(:first-child)]:mt-1.5',
        className
      )}
      ref={ref}
      {...props}
    />
  )
)

PopoverScrollArea.displayName = 'PopoverScrollArea'

interface PopoverItemProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Whether this item has active/highlighted background styling.
   * Use for keyboard navigation focus or persistent highlight states.
   */
  active?: boolean
  /** Only show when not inside any folder */
  rootOnly?: boolean
  /** Whether this item is disabled */
  disabled?: boolean
  /**
   * Show a checkmark to indicate selection/checked state.
   * Unlike `active`, this only shows the checkmark without background highlight,
   * following the pattern where hover provides interaction feedback
   * and checkmarks indicate current value.
   * @default false
   */
  showCheck?: boolean
}

/**
 * Individual popover item with hover and active states.
 */
const PopoverItem = React.forwardRef<HTMLDivElement, PopoverItemProps>(
  (
    {
      className,
      active,
      rootOnly,
      disabled,
      showCheck = false,
      children,
      onClick,
      onMouseEnter,
      ...props
    },
    ref
  ) => {
    const context = React.useContext(PopoverContext)
    const size = context?.size || 'md'
    const colorScheme = context?.colorScheme || 'default'
    const itemRef = React.useRef<HTMLDivElement>(null)
    const [itemIndex, setItemIndex] = React.useState(-1)

    const mergedRef = React.useCallback(
      (node: HTMLDivElement | null) => {
        itemRef.current = node
        if (typeof ref === 'function') {
          ref(node)
        } else if (ref) {
          ref.current = node
        }
      },
      [ref]
    )

    React.useEffect(() => {
      if (!itemRef.current) return
      const content = itemRef.current.closest('[data-radix-popper-content-wrapper]')
      if (!content) return
      const items = content.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])')
      const index = Array.from(items).indexOf(itemRef.current)
      setItemIndex(index)
    }, [])

    if (rootOnly && context?.isInFolder) return null

    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) {
        e.stopPropagation()
        return
      }
      onClick?.(e)
    }

    const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
      context?.setLastHoveredItem(null)
      // Don't update selection during keyboard navigation to prevent scroll jumps
      if (itemIndex >= 0 && context && !context.isKeyboardNav) {
        context.setSelectedIndex(itemIndex)
      }
      onMouseEnter?.(e)
    }

    // Determine if this item is active:
    // - Use explicit `active` prop if provided
    // - Otherwise use context selectedIndex match
    const isActive =
      active !== undefined ? active : itemIndex >= 0 && context?.selectedIndex === itemIndex

    // Suppress hover when in keyboard mode to prevent dual highlights
    const suppressHover = context?.isKeyboardNav && !isActive

    return (
      <div
        ref={mergedRef}
        className={cn(
          STYLES.itemBase,
          STYLES.colorScheme[colorScheme].text,
          STYLES.size[size].item,
          getItemStateClasses(colorScheme, !!isActive),
          suppressHover && 'hover-hover:bg-transparent!',
          disabled && 'pointer-events-none cursor-not-allowed opacity-50',
          className
        )}
        role='menuitem'
        aria-selected={isActive}
        aria-disabled={disabled}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') (e.currentTarget as HTMLElement).click()
        }}
        onMouseEnter={handleMouseEnter}
        {...props}
      >
        {children}
        {showCheck && <Check className={cn('ml-auto', STYLES.size[size].icon)} />}
      </div>
    )
  }
)

PopoverItem.displayName = 'PopoverItem'

interface PopoverSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Only show when not inside any folder */
  rootOnly?: boolean
}

/**
 * Section header for grouping popover items.
 */
const PopoverSection = React.forwardRef<HTMLDivElement, PopoverSectionProps>(
  ({ className, rootOnly, ...props }, ref) => {
    const context = React.useContext(PopoverContext)
    const size = context?.size || 'md'
    const colorScheme = context?.colorScheme || 'default'

    if (rootOnly && context?.isInFolder) return null

    return (
      <div
        className={cn(
          'mt-1.5 min-w-0 first:mt-0 first:pt-0',
          STYLES.size[size].section,
          STYLES.colorScheme[colorScheme].section,
          className
        )}
        data-popover-section=''
        ref={ref}
        {...props}
      />
    )
  }
)

PopoverSection.displayName = 'PopoverSection'

interface PopoverFolderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Unique folder identifier */
  id: string
  /** Display title */
  title: string
  /** Icon before title */
  icon?: React.ReactNode
  /** Callback when folder opens (for lazy loading) */
  onOpen?: () => void | Promise<void>
  /** Folder contents */
  children?: React.ReactNode
  /** Whether currently active/selected */
  active?: boolean
  /**
   * Expand folder on hover to show submenu alongside parent
   * When true, hovering shows a floating submenu; clicking still uses inline navigation
   * @default false
   */
  expandOnHover?: boolean
}

/**
 * Expandable folder that shows nested content.
 * Supports two modes:
 * - Click mode (default): Replaces parent content
 * - Hover mode (expandOnHover): Shows floating submenu alongside parent
 */
const PopoverFolder = React.forwardRef<HTMLDivElement, PopoverFolderProps>(
  (
    { className, id, title, icon, onOpen, children, active, expandOnHover = false, ...props },
    ref
  ) => {
    const {
      openFolder,
      currentFolder,
      isInFolder,
      size,
      colorScheme,
      lastHoveredItem,
      setLastHoveredItem,
      isKeyboardNav,
      selectedIndex,
      setSelectedIndex,
    } = usePopoverContext()
    const [submenuPosition, setSubmenuPosition] = React.useState<{ top: number; left: number }>({
      top: 0,
      left: 0,
    })
    const triggerRef = React.useRef<HTMLDivElement>(null)
    const [itemIndex, setItemIndex] = React.useState(-1)

    const isHoverOpen = expandOnHover && lastHoveredItem === id

    const mergedRef = React.useCallback(
      (node: HTMLDivElement | null) => {
        triggerRef.current = node
        if (typeof ref === 'function') {
          ref(node)
        } else if (ref) {
          ref.current = node
        }
      },
      [ref]
    )

    React.useEffect(() => {
      if (!triggerRef.current) return
      const content = triggerRef.current.closest('[data-radix-popper-content-wrapper]')
      if (!content) return
      const items = content.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])')
      const index = Array.from(items).indexOf(triggerRef.current)
      setItemIndex(index)
    }, [])

    if (isInFolder && currentFolder !== id) return null
    if (currentFolder === id) return <>{children}</>

    const handleClickOpen = () => {
      openFolder(id, onOpen)
    }

    const handleClick = (e: React.MouseEvent) => {
      e.stopPropagation()
      if (expandOnHover) {
        setLastHoveredItem(null)
      }
      handleClickOpen()
    }

    const handleMouseEnter = () => {
      // Don't update selection during keyboard navigation to prevent scroll jumps
      if (itemIndex >= 0 && !isKeyboardNav) {
        setSelectedIndex(itemIndex)
      }

      if (!expandOnHover) return

      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect()
        const parentPopover = triggerRef.current.closest('[data-radix-popper-content-wrapper]')
        const parentRect = parentPopover?.getBoundingClientRect()

        setSubmenuPosition({
          top: rect.top,
          left: parentRect ? parentRect.right + 4 : rect.right + 4,
        })
      }

      setLastHoveredItem(id)
      onOpen?.()
    }

    const isActive = active !== undefined ? active : itemIndex >= 0 && selectedIndex === itemIndex

    // Suppress hover when in keyboard mode to prevent dual highlights
    const suppressHover = isKeyboardNav && !isActive && !isHoverOpen

    return (
      <>
        <div
          ref={mergedRef}
          className={cn(
            STYLES.itemBase,
            STYLES.colorScheme[colorScheme].text,
            STYLES.size[size].item,
            getItemStateClasses(colorScheme, isActive || isHoverOpen),
            suppressHover && 'hover-hover:bg-transparent!',
            className
          )}
          role='menuitem'
          aria-haspopup='true'
          aria-expanded={isHoverOpen}
          aria-selected={isActive}
          onClick={handleClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') (e.currentTarget as HTMLElement).click()
          }}
          onMouseEnter={handleMouseEnter}
          {...props}
        >
          {icon}
          <span className='flex-1'>{title}</span>
          <ChevronRight className={STYLES.size[size].icon} />
        </div>

        {/* Hover submenu - rendered as a portal to escape overflow clipping */}
        {isHoverOpen &&
          typeof document !== 'undefined' &&
          createPortal(
            <DismissableLayerBranch
              data-native-surface-overlay=''
              className={cn(
                'fixed z-[calc(var(--z-popover)+1)] min-w-[120px]',
                STYLES.content,
                STYLES.colorScheme[colorScheme].content
              )}
              style={{
                top: submenuPosition.top,
                left: submenuPosition.left,
                pointerEvents: 'auto',
              }}
            >
              {children}
            </DismissableLayerBranch>,
            document.body
          )}
      </>
    )
  }
)

PopoverFolder.displayName = 'PopoverFolder'

interface PopoverDividerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Only show when not inside any folder */
  rootOnly?: boolean
}

/**
 * Horizontal divider for separating popover sections.
 */
const PopoverDivider = React.forwardRef<HTMLDivElement, PopoverDividerProps>(
  ({ className, rootOnly, ...props }, ref) => {
    const context = React.useContext(PopoverContext)
    const colorScheme = context?.colorScheme || 'default'

    if (rootOnly && context?.isInFolder) return null

    return (
      <div
        ref={ref}
        className={cn(MENU_STYLES.separator, STYLES.colorScheme[colorScheme].divider, className)}
        role='separator'
        {...props}
      />
    )
  }
)

PopoverDivider.displayName = 'PopoverDivider'

export {
  Popover,
  PopoverTrigger,
  PopoverAnchor,
  PopoverContent,
  PopoverScrollArea,
  PopoverItem,
  PopoverSection,
  PopoverFolder,
  PopoverDivider,
  usePopoverContext,
}
