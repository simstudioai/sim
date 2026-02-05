/**
 * Popover component system with built-in folder navigation and automatic viewport positioning.
 * Uses Radix UI primitives for collision detection and smart placement.
 *
 * @example
 * Basic usage with folders:
 * ```tsx
 * import { Popover, PopoverAnchor, PopoverBackButton, PopoverContent, PopoverFolder, PopoverItem } from '@/components/emcn'
 * import { Workflow, Bot } from 'lucide-react'
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
 *         <PopoverBackButton />
 *         <PopoverItem rootOnly onClick={() => console.log('Docs')}>
 *           <BookOpen className="h-3.5 w-3.5" />
 *           <span>Docs</span>
 *         </PopoverItem>
 *
 *         <PopoverFolder
 *           id="workflows"
 *           title="All workflows"
 *           icon={<Workflow className="h-3.5 w-3.5" />}
 *           onOpen={async () => {
 *             const data = await fetchWorkflows()
 *             setWorkflows(data)
 *           }}
 *         >
 *           {workflows.map(wf => (
 *             <PopoverItem key={wf.id} onClick={() => selectWorkflow(wf)}>
 *               <div className="h-3.5 w-3.5 rounded" style={{ backgroundColor: wf.color }} />
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
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Check, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/core/utils/cn'

type PopoverSize = 'sm' | 'md'
type PopoverColorScheme = 'default' | 'inverted'
type PopoverVariant = 'default' | 'secondary'

/**
 * Style constants for popover components.
 * Organized by component type and property.
 */
const STYLES = {
  /** Base classes shared by all interactive items */
  itemBase:
    'flex min-w-0 cursor-pointer items-center gap-[8px] rounded-[6px] px-[6px] font-base disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed',

  /** Content container */
  content: 'px-[6px] py-[6px] rounded-[6px]',

  /** Size variants */
  size: {
    sm: { item: 'h-[22px] text-[11px]', icon: 'h-3 w-3', section: 'px-[6px] py-[4px] text-[11px]' },
    md: {
      item: 'h-[26px] text-[13px]',
      icon: 'h-3.5 w-3.5',
      section: 'px-[6px] py-[4px] text-[13px]',
    },
  } satisfies Record<PopoverSize, { item: string; icon: string; section: string }>,

  /** Color scheme variants */
  colorScheme: {
    default: {
      text: 'text-[var(--text-primary)]',
      section: 'text-[var(--text-tertiary)]',
      search: 'text-[var(--text-muted)]',
      searchInput: 'text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
      content: 'bg-[var(--surface-5)] text-foreground dark:bg-[var(--surface-3)]',
      divider: 'border-[var(--border-1)]',
    },
    inverted: {
      text: 'text-white dark:text-[var(--text-primary)]',
      section: 'text-[var(--text-muted-inverse)]',
      search: 'text-[var(--text-muted-inverse)] dark:text-[var(--text-muted)]',
      searchInput:
        'text-white placeholder:text-[var(--text-muted-inverse)] dark:text-[var(--text-primary)] dark:placeholder:text-[var(--text-muted)]',
      content: 'bg-[#1b1b1b] text-white dark:bg-[var(--surface-3)] dark:text-foreground',
      divider: 'border-[#363636] dark:border-[var(--border-1)]',
    },
  } satisfies Record<
    PopoverColorScheme,
    {
      text: string
      section: string
      search: string
      searchInput: string
      content: string
      divider: string
    }
  >,

  /** Interactive state styles: default, secondary (brand), inverted (dark bg in light mode) */
  states: {
    default: {
      active: 'bg-[var(--border-1)] text-[var(--text-primary)] [&_svg]:text-[var(--text-primary)]',
      hover:
        'hover:bg-[var(--border-1)] hover:text-[var(--text-primary)] hover:[&_svg]:text-[var(--text-primary)]',
    },
    secondary: {
      active: 'bg-[var(--brand-secondary)] text-white [&_svg]:text-white',
      hover: 'hover:bg-[var(--brand-secondary)] hover:text-white hover:[&_svg]:text-white',
    },
    inverted: {
      active:
        'bg-[#363636] text-white [&_svg]:text-white dark:bg-[var(--surface-5)] dark:text-[var(--text-primary)] dark:[&_svg]:text-[var(--text-primary)]',
      hover:
        'hover:bg-[#363636] hover:text-white hover:[&_svg]:text-white dark:hover:bg-[var(--surface-5)] dark:hover:text-[var(--text-primary)] dark:hover:[&_svg]:text-[var(--text-primary)]',
    },
  },
} as const

/**
 * Gets the active/hover classes for a popover item.
 * Uses variant for secondary, otherwise colorScheme determines default vs inverted.
 */
function getItemStateClasses(
  variant: PopoverVariant,
  colorScheme: PopoverColorScheme,
  isActive: boolean
): string {
  const state = isActive ? 'active' : 'hover'

  if (variant === 'secondary') {
    return STYLES.states.secondary[state]
  }

  return colorScheme === 'inverted' ? STYLES.states.inverted[state] : STYLES.states.default[state]
}

interface PopoverContextValue {
  openFolder: (
    id: string,
    title: string,
    onLoad?: () => void | Promise<void>,
    onSelect?: () => void
  ) => void
  closeFolder: () => void
  currentFolder: string | null
  isInFolder: boolean
  folderTitle: string | null
  onFolderSelect: (() => void) | null
  variant: PopoverVariant
  size: PopoverSize
  colorScheme: PopoverColorScheme
  searchQuery: string
  setSearchQuery: (query: string) => void
  /** ID of the last hovered item (for hover submenus) */
  lastHoveredItem: string | null
  setLastHoveredItem: (id: string | null) => void
  /** Whether keyboard navigation is active. When true, hover styles are suppressed. */
  isKeyboardNav: boolean
  setKeyboardNav: (value: boolean) => void
  /** Currently selected item index for keyboard navigation */
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  /** Register a menu item and get its index. Returns a cleanup function. */
  registerItem: (id: string) => number
  /** Unregister a menu item */
  unregisterItem: (id: string) => void
  /** Get the total number of registered items */
  itemCount: number
}

const PopoverContext = React.createContext<PopoverContextValue | null>(null)

const usePopoverContext = () => {
  const context = React.useContext(PopoverContext)
  if (!context) {
    throw new Error('Popover components must be used within a Popover')
  }
  return context
}

export interface PopoverProps extends PopoverPrimitive.PopoverProps {
  /**
   * Visual variant of the popover
   * @default 'default'
   */
  variant?: PopoverVariant
  /**
   * Size variant of the popover
   * - sm: 11px text, compact spacing (for logs, notifications, context menus)
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
  variant = 'default',
  size = 'md',
  colorScheme = 'default',
  open,
  ...props
}) => {
  const [currentFolder, setCurrentFolder] = React.useState<string | null>(null)
  const [folderTitle, setFolderTitle] = React.useState<string | null>(null)
  const [onFolderSelect, setOnFolderSelect] = React.useState<(() => void) | null>(null)
  const [searchQuery, setSearchQuery] = React.useState<string>('')
  const [lastHoveredItem, setLastHoveredItem] = React.useState<string | null>(null)
  const [isKeyboardNav, setIsKeyboardNav] = React.useState(false)
  const [selectedIndex, setSelectedIndex] = React.useState(-1)
  const registeredItemsRef = React.useRef<string[]>([])

  const registerItem = React.useCallback((id: string) => {
    if (!registeredItemsRef.current.includes(id)) {
      registeredItemsRef.current.push(id)
    }
    return registeredItemsRef.current.indexOf(id)
  }, [])

  const unregisterItem = React.useCallback((id: string) => {
    const index = registeredItemsRef.current.indexOf(id)
    if (index !== -1) {
      registeredItemsRef.current.splice(index, 1)
    }
  }, [])

  React.useEffect(() => {
    if (open === false) {
      setCurrentFolder(null)
      setFolderTitle(null)
      setOnFolderSelect(null)
      setSearchQuery('')
      setLastHoveredItem(null)
      setIsKeyboardNav(false)
      setSelectedIndex(-1)
      registeredItemsRef.current = []
    } else {
      // Reset hover state when opening to prevent stale submenu from previous menu
      setLastHoveredItem(null)
    }
  }, [open])

  const openFolder = React.useCallback(
    (id: string, title: string, onLoad?: () => void | Promise<void>, onSelect?: () => void) => {
      setCurrentFolder(id)
      setFolderTitle(title)
      setOnFolderSelect(() => onSelect ?? null)
      if (onLoad) {
        void Promise.resolve(onLoad())
      }
    },
    []
  )

  const closeFolder = React.useCallback(() => {
    setCurrentFolder(null)
    setFolderTitle(null)
    setOnFolderSelect(null)
  }, [])

  const setKeyboardNav = React.useCallback((value: boolean) => {
    setIsKeyboardNav(value)
  }, [])

  const itemCount = registeredItemsRef.current.length

  const contextValue = React.useMemo<PopoverContextValue>(
    () => ({
      openFolder,
      closeFolder,
      currentFolder,
      isInFolder: currentFolder !== null,
      folderTitle,
      onFolderSelect,
      variant,
      size,
      colorScheme,
      searchQuery,
      setSearchQuery,
      lastHoveredItem,
      setLastHoveredItem,
      isKeyboardNav,
      setKeyboardNav,
      selectedIndex,
      setSelectedIndex,
      registerItem,
      unregisterItem,
      itemCount,
    }),
    [
      openFolder,
      closeFolder,
      currentFolder,
      folderTitle,
      onFolderSelect,
      variant,
      size,
      colorScheme,
      searchQuery,
      lastHoveredItem,
      isKeyboardNav,
      setKeyboardNav,
      selectedIndex,
      registerItem,
      unregisterItem,
      itemCount,
    ]
  )

  return (
    <PopoverContext.Provider value={contextValue}>
      <PopoverPrimitive.Root open={open} {...props}>
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

export interface PopoverContentProps
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
  /** Maximum width in pixels. Enables text truncation when set. */
  maxWidth?: number
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
   * @default false
   */
  border?: boolean
  /**
   * Flip to avoid viewport collisions
   * @default true
   */
  avoidCollisions?: boolean
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
      border = false,
      avoidCollisions = true,
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

    const hasUserWidthConstraint =
      maxWidth !== undefined ||
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
        className={cn(
          'z-[10000200] flex flex-col overflow-auto outline-none will-change-transform',
          STYLES.colorScheme[colorScheme].content,
          STYLES.content,
          hasUserWidthConstraint && '[&_.flex-1]:truncate [&_[data-popover-section]]:truncate',
          border && 'border border-[var(--border-1)]',
          className
        )}
        style={{
          maxHeight: `${maxHeight || 400}px`,
          maxWidth: maxWidth !== undefined ? `${maxWidth}px` : 'calc(100vw - 16px)',
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
        {children}
      </PopoverPrimitive.Content>
    )

    if (disablePortal) return content

    return <PopoverPrimitive.Portal>{content}</PopoverPrimitive.Portal>
  }
)

PopoverContent.displayName = 'PopoverContent'

export interface PopoverScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * Scrollable container for popover items.
 */
const PopoverScrollArea = React.forwardRef<HTMLDivElement, PopoverScrollAreaProps>(
  ({ className, ...props }, ref) => (
    <div
      className={cn(
        'min-h-0 overflow-auto overscroll-contain',
        '[&>div:has([data-popover-section]):not(:first-child)]:mt-[6px]',
        className
      )}
      ref={ref}
      {...props}
    />
  )
)

PopoverScrollArea.displayName = 'PopoverScrollArea'

export interface PopoverItemProps extends React.HTMLAttributes<HTMLDivElement> {
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
    const variant = context?.variant || 'default'
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
          getItemStateClasses(variant, colorScheme, !!isActive),
          suppressHover && 'hover:!bg-transparent',
          disabled && 'pointer-events-none cursor-not-allowed opacity-50',
          className
        )}
        role='menuitem'
        aria-selected={isActive}
        aria-disabled={disabled}
        onClick={handleClick}
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

export interface PopoverSectionProps extends React.HTMLAttributes<HTMLDivElement> {
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
          'mt-[6px] min-w-0 font-base first:mt-0 first:pt-0',
          STYLES.colorScheme[colorScheme].section,
          STYLES.size[size].section,
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

export interface PopoverFolderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Unique folder identifier */
  id: string
  /** Display title */
  title: string
  /** Icon before title */
  icon?: React.ReactNode
  /** Callback when folder opens (for lazy loading) */
  onOpen?: () => void | Promise<void>
  /** Callback when folder title is selected from within folder view */
  onSelect?: () => void
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
 * - Click mode (default): Replaces parent content, shows back button
 * - Hover mode (expandOnHover): Shows floating submenu alongside parent
 */
const PopoverFolder = React.forwardRef<HTMLDivElement, PopoverFolderProps>(
  (
    {
      className,
      id,
      title,
      icon,
      onOpen,
      onSelect,
      children,
      active,
      expandOnHover = false,
      ...props
    },
    ref
  ) => {
    const {
      openFolder,
      currentFolder,
      isInFolder,
      variant,
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
      openFolder(id, title, onOpen, onSelect)
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
            getItemStateClasses(variant, colorScheme, isActive || isHoverOpen),
            suppressHover && 'hover:!bg-transparent',
            className
          )}
          role='menuitem'
          aria-haspopup='true'
          aria-expanded={isHoverOpen}
          aria-selected={isActive}
          onClick={handleClick}
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
            <div
              className={cn(
                'fixed z-[10000201] min-w-[120px]',
                STYLES.content,
                STYLES.colorScheme[colorScheme].content,
                'shadow-lg'
              )}
              style={{
                top: submenuPosition.top,
                left: submenuPosition.left,
              }}
            >
              {children}
            </div>,
            document.body
          )}
      </>
    )
  }
)

PopoverFolder.displayName = 'PopoverFolder'

export interface PopoverBackButtonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Ref callback for folder title element */
  folderTitleRef?: (el: HTMLElement | null) => void
  /** Whether folder title is active/selected */
  folderTitleActive?: boolean
  /** Callback on folder title mouse enter */
  onFolderTitleMouseEnter?: () => void
}

/**
 * Back button shown inside folders. Hidden at root level.
 */
const PopoverBackButton = React.forwardRef<HTMLDivElement, PopoverBackButtonProps>(
  ({ className, folderTitleRef, folderTitleActive, onFolderTitleMouseEnter, ...props }, ref) => {
    const { isInFolder, closeFolder, folderTitle, onFolderSelect, variant, size, colorScheme } =
      usePopoverContext()

    if (!isInFolder) return null

    return (
      <div className='flex flex-col'>
        <div
          ref={ref}
          className={cn(
            'peer',
            STYLES.itemBase,
            STYLES.colorScheme[colorScheme].text,
            STYLES.size[size].item,
            getItemStateClasses(variant, colorScheme, false),
            className
          )}
          role='button'
          onClick={(e) => {
            e.stopPropagation()
            closeFolder()
          }}
          {...props}
        >
          <ChevronLeft className={STYLES.size[size].icon} />
          <span>Back</span>
        </div>
        {folderTitle && onFolderSelect && (
          <div
            ref={folderTitleRef}
            className={cn(
              STYLES.itemBase,
              STYLES.colorScheme[colorScheme].text,
              STYLES.size[size].item,
              getItemStateClasses(variant, colorScheme, !!folderTitleActive),
              'peer-hover:!bg-transparent'
            )}
            role='button'
            onClick={(e) => {
              e.stopPropagation()
              onFolderSelect()
            }}
            onMouseEnter={onFolderTitleMouseEnter}
          >
            <span>{folderTitle}</span>
          </div>
        )}
        {folderTitle && !onFolderSelect && (
          <div
            className={cn(
              'font-base',
              STYLES.colorScheme[colorScheme].section,
              STYLES.size[size].section
            )}
          >
            {folderTitle}
          </div>
        )}
      </div>
    )
  }
)

PopoverBackButton.displayName = 'PopoverBackButton'

export interface PopoverSearchProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Placeholder text
   * @default 'Search...'
   */
  placeholder?: string
  /** Callback when query changes */
  onValueChange?: (value: string) => void
}

/**
 * Search input for filtering popover items.
 */
const PopoverSearch = React.forwardRef<HTMLDivElement, PopoverSearchProps>(
  ({ className, placeholder = 'Search...', onValueChange, ...props }, ref) => {
    const { searchQuery, setSearchQuery, size, colorScheme } = usePopoverContext()
    const inputRef = React.useRef<HTMLInputElement>(null)

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setSearchQuery(value)
      onValueChange?.(value)
    }

    React.useEffect(() => {
      setSearchQuery('')
      onValueChange?.('')
      inputRef.current?.focus()
    }, [setSearchQuery, onValueChange])

    return (
      <div ref={ref} className={cn('flex items-center px-[8px] py-[6px]', className)} {...props}>
        <Search
          className={cn(
            'mr-2 shrink-0',
            STYLES.colorScheme[colorScheme].search,
            STYLES.size[size].icon
          )}
        />
        <input
          ref={inputRef}
          className={cn(
            'w-full bg-transparent font-base focus:outline-none',
            STYLES.colorScheme[colorScheme].searchInput,
            size === 'sm' ? 'text-[11px]' : 'text-[13px]'
          )}
          placeholder={placeholder}
          value={searchQuery}
          onChange={handleChange}
        />
      </div>
    )
  }
)

PopoverSearch.displayName = 'PopoverSearch'

export interface PopoverDividerProps extends React.HTMLAttributes<HTMLDivElement> {
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
        className={cn('my-[6px] border-t', STYLES.colorScheme[colorScheme].divider, className)}
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
  PopoverBackButton,
  PopoverSearch,
  PopoverDivider,
  usePopoverContext,
}

export type { PopoverSize, PopoverColorScheme }
