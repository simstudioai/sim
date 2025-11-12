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
 *           <BookOpen className="h-3 w-3" />
 *           <span>Docs</span>
 *         </PopoverItem>
 *
 *         <PopoverFolder
 *           id="workflows"
 *           title="All workflows"
 *           icon={<Workflow className="h-3 w-3" />}
 *           onOpen={async () => {
 *             const data = await fetchWorkflows()
 *             setWorkflows(data)
 *           }}
 *         >
 *           {workflows.map(wf => (
 *             <PopoverItem key={wf.id} onClick={() => selectWorkflow(wf)}>
 *               <div className="h-3 w-3 rounded" style={{ backgroundColor: wf.color }} />
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
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Shared base styles for all popover interactive items.
 * Ensures consistent height and styling across items, folders, and back button.
 */
const POPOVER_ITEM_BASE_CLASSES =
  'flex h-[25px] min-w-0 cursor-pointer items-center gap-[8px] rounded-[6px] px-[6px] font-base text-[var(--text-primary)] text-[12px] transition-colors dark:text-[var(--text-primary)] [&_svg]:transition-colors disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed'

/**
 * Variant-specific active state styles for popover items.
 */
const POPOVER_ITEM_ACTIVE_CLASSES = {
  primary:
    'bg-[var(--brand-secondary)] text-[var(--bg)] dark:bg-[var(--brand-secondary)] dark:text-[var(--bg)] [&_svg]:text-[var(--bg)] dark:[&_svg]:text-[var(--bg)]',
  default:
    'bg-[var(--surface-9)] text-[var(--text-primary)] dark:bg-[var(--surface-9)] dark:text-[var(--text-primary)] [&_svg]:text-[var(--text-primary)] dark:[&_svg]:text-[var(--text-primary)]',
}

/**
 * Variant-specific hover state styles for popover items.
 */
const POPOVER_ITEM_HOVER_CLASSES = {
  primary:
    'hover:bg-[var(--brand-secondary)] hover:text-[var(--bg)] dark:hover:bg-[var(--brand-secondary)] dark:hover:text-[var(--bg)] hover:[&_svg]:text-[var(--bg)] dark:hover:[&_svg]:text-[var(--bg)]',
  default:
    'hover:bg-[var(--surface-9)] hover:text-[var(--text-primary)] dark:hover:bg-[var(--surface-9)] dark:hover:text-[var(--text-primary)] hover:[&_svg]:text-[var(--text-primary)] dark:hover:[&_svg]:text-[var(--text-primary)]',
}

type PopoverVariant = 'default' | 'primary'

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
  searchQuery: string
  setSearchQuery: (query: string) => void
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
}

/**
 * Root popover component. Manages open state and folder navigation context.
 *
 * @example
 * ```tsx
 * <Popover open={open} onOpenChange={setOpen} variant="default">
 *   <PopoverAnchor>...</PopoverAnchor>
 *   <PopoverContent>...</PopoverContent>
 * </Popover>
 * ```
 */
const Popover: React.FC<PopoverProps> = ({ children, variant = 'default', ...props }) => {
  const [currentFolder, setCurrentFolder] = React.useState<string | null>(null)
  const [folderTitle, setFolderTitle] = React.useState<string | null>(null)
  const [onFolderSelect, setOnFolderSelect] = React.useState<(() => void) | null>(null)
  const [searchQuery, setSearchQuery] = React.useState<string>('')

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

  const contextValue: PopoverContextValue = React.useMemo(
    () => ({
      openFolder,
      closeFolder,
      currentFolder,
      isInFolder: currentFolder !== null,
      folderTitle,
      onFolderSelect,
      variant,
      searchQuery,
      setSearchQuery,
    }),
    [openFolder, closeFolder, currentFolder, folderTitle, onFolderSelect, variant, searchQuery]
  )

  return (
    <PopoverContext.Provider value={contextValue}>
      <PopoverPrimitive.Root {...props}>{children}</PopoverPrimitive.Root>
    </PopoverContext.Provider>
  )
}

Popover.displayName = 'Popover'

/**
 * Trigger element that opens/closes the popover when clicked.
 * Use asChild to render as a custom component.
 *
 * @example
 * ```tsx
 * <PopoverTrigger asChild>
 *   <Button>Open Menu</Button>
 * </PopoverTrigger>
 * ```
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
   * Maximum height for the popover content in pixels
   */
  maxHeight?: number
  /**
   * Preferred side to display the popover
   * @default 'bottom'
   */
  side?: 'top' | 'right' | 'bottom' | 'left'
  /**
   * Alignment of the popover relative to anchor
   * @default 'start'
   */
  align?: 'start' | 'center' | 'end'
  /**
   * Offset from the anchor in pixels.
   * Defaults to 22px for top side (to avoid covering cursor) and 10px for other sides.
   */
  sideOffset?: number
  /**
   * Padding from viewport edges in pixels
   * @default 8
   */
  collisionPadding?: number
}

/**
 * Popover content component with automatic positioning and collision detection.
 * Wraps children in a styled container with scrollable area.
 *
 * @example
 * ```tsx
 * <PopoverContent maxHeight={300}>
 *   <PopoverItem>Item 1</PopoverItem>
 *   <PopoverItem>Item 2</PopoverItem>
 * </PopoverContent>
 * ```
 */
const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(
  (
    {
      className,
      style,
      children,
      maxHeight,
      side = 'bottom',
      align = 'start',
      sideOffset,
      collisionPadding = 8,
      ...restProps
    },
    ref
  ) => {
    // Smart default offset: larger offset when rendering above to avoid covering cursor
    const effectiveSideOffset = sideOffset ?? (side === 'top' ? 20 : 14)

    // Detect explicit width constraints provided by the consumer.
    // When present, we enable default text truncation behavior for inner flexible items,
    // so callers don't need to manually pass 'truncate' to every label.
    const hasUserWidthConstraint =
      style?.minWidth !== undefined || style?.maxWidth !== undefined || style?.width !== undefined

    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={ref}
          side={side}
          align={align}
          sideOffset={effectiveSideOffset}
          collisionPadding={collisionPadding}
          avoidCollisions={true}
          sticky='partial'
          {...restProps}
          className={cn(
            'z-[9999999] flex flex-col overflow-hidden rounded-[8px] bg-[var(--surface-3)] px-[5.5px] py-[5px] text-foreground outline-none dark:bg-[var(--surface-3)]',
            // If width is constrained by the caller, ensure inner flexible text truncates by default.
            hasUserWidthConstraint && '[&_.flex-1]:truncate',
            className
          )}
          style={{
            maxHeight: `${maxHeight || 400}px`,
            maxWidth: 'calc(100vw - 16px)',
            minWidth: '160px',
            ...style,
          }}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    )
  }
)

PopoverContent.displayName = 'PopoverContent'

export interface PopoverScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * Scrollable area container for popover items.
 * Use this to wrap items that should scroll within the popover.
 *
 * @example
 * ```tsx
 * <PopoverContent>
 *   <PopoverScrollArea>
 *     <PopoverItem>Item 1</PopoverItem>
 *     <PopoverItem>Item 2</PopoverItem>
 *   </PopoverScrollArea>
 * </PopoverContent>
 * ```
 */
const PopoverScrollArea = React.forwardRef<HTMLDivElement, PopoverScrollAreaProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        className={cn('min-h-0 flex-1 overflow-auto overscroll-contain', className)}
        ref={ref}
        {...props}
      />
    )
  }
)

PopoverScrollArea.displayName = 'PopoverScrollArea'

export interface PopoverItemProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Whether this item is currently active/selected
   */
  active?: boolean
  /**
   * If true, this item will only show when not inside any folder
   */
  rootOnly?: boolean
  /**
   * Whether this item is disabled
   */
  disabled?: boolean
}

/**
 * Popover item component for individual items within a popover.
 *
 * @example
 * ```tsx
 * <PopoverItem active={isActive} disabled={isDisabled} onClick={() => handleClick()}>
 *   <Icon className="h-4 w-4" />
 *   <span>Item label</span>
 * </PopoverItem>
 * ```
 */
const PopoverItem = React.forwardRef<HTMLDivElement, PopoverItemProps>(
  ({ className, active, rootOnly, disabled, ...props }, ref) => {
    // Try to get context - if not available, we're outside Popover (shouldn't happen)
    const context = React.useContext(PopoverContext)
    const variant = context?.variant || 'default'

    // If rootOnly is true and we're in a folder, don't render
    if (rootOnly && context?.isInFolder) {
      return null
    }

    return (
      <div
        className={cn(
          POPOVER_ITEM_BASE_CLASSES,
          active ? POPOVER_ITEM_ACTIVE_CLASSES[variant] : POPOVER_ITEM_HOVER_CLASSES[variant],
          disabled && 'pointer-events-none cursor-not-allowed opacity-50',
          className
        )}
        ref={ref}
        role='menuitem'
        aria-selected={active}
        aria-disabled={disabled}
        {...props}
      />
    )
  }
)

PopoverItem.displayName = 'PopoverItem'

export interface PopoverSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * If true, this section will only show when not inside any folder
   */
  rootOnly?: boolean
}

/**
 * Popover section header component for grouping items with a title.
 *
 * @example
 * ```tsx
 * <PopoverSection>
 *   Section Title
 * </PopoverSection>
 * ```
 */
const PopoverSection = React.forwardRef<HTMLDivElement, PopoverSectionProps>(
  ({ className, rootOnly, ...props }, ref) => {
    const context = React.useContext(PopoverContext)

    // If rootOnly is true and we're in a folder, don't render
    if (rootOnly && context?.isInFolder) {
      return null
    }

    return (
      <div
        className={cn(
          'px-[6px] py-[4px] font-base text-[12px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)

PopoverSection.displayName = 'PopoverSection'

export interface PopoverFolderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /**
   * Unique identifier for the folder
   */
  id: string
  /**
   * Display title for the folder
   */
  title: string
  /**
   * Icon to display before the title
   */
  icon?: React.ReactNode
  /**
   * Function to call when folder is opened (for lazy loading)
   */
  onOpen?: () => void | Promise<void>
  /**
   * Function to call when the folder title is selected (from within the folder view)
   */
  onSelect?: () => void
  /**
   * Children to render when folder is open
   */
  children?: React.ReactNode
  /**
   * Whether this item is currently active/selected
   */
  active?: boolean
}

/**
 * Popover folder component that expands to show nested content.
 * Automatically handles navigation and back button rendering.
 *
 * @example
 * ```tsx
 * <PopoverFolder id="workflows" title="Workflows" icon={<Icon />}>
 *   <PopoverItem>Workflow 1</PopoverItem>
 *   <PopoverItem>Workflow 2</PopoverItem>
 * </PopoverFolder>
 * ```
 */
const PopoverFolder = React.forwardRef<HTMLDivElement, PopoverFolderProps>(
  ({ className, id, title, icon, onOpen, onSelect, children, active, ...props }, ref) => {
    const { openFolder, currentFolder, isInFolder, variant } = usePopoverContext()

    // Don't render if we're in a different folder
    if (isInFolder && currentFolder !== id) {
      return null
    }

    // If we're in this folder, render its children
    if (currentFolder === id) {
      return <>{children}</>
    }

    // Handle click anywhere on folder item
    const handleClick = (e: React.MouseEvent) => {
      e.stopPropagation()
      openFolder(id, title, onOpen, onSelect)
    }

    // Otherwise, render as a clickable folder item
    return (
      <div
        ref={ref}
        className={cn(
          POPOVER_ITEM_BASE_CLASSES,
          active ? POPOVER_ITEM_ACTIVE_CLASSES[variant] : POPOVER_ITEM_HOVER_CLASSES[variant],
          className
        )}
        role='menuitem'
        aria-haspopup='true'
        aria-expanded={false}
        onClick={handleClick}
        {...props}
      >
        {icon}
        <span className='flex-1'>{title}</span>
        <ChevronRight className='h-3 w-3' />
      </div>
    )
  }
)

PopoverFolder.displayName = 'PopoverFolder'

export interface PopoverBackButtonProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Ref callback for the folder title element (when selectable)
   */
  folderTitleRef?: (el: HTMLElement | null) => void
  /**
   * Whether the folder title is currently active/selected
   */
  folderTitleActive?: boolean
  /**
   * Callback when mouse enters the folder title
   */
  onFolderTitleMouseEnter?: () => void
}

/**
 * Back button component that appears when inside a folder.
 * Automatically hidden when at root level.
 *
 * @example
 * ```tsx
 * <Popover>
 *   <PopoverBackButton />
 *   <PopoverContent>
 *     // content
 *   </PopoverContent>
 * </Popover>
 * ```
 */
const PopoverBackButton = React.forwardRef<HTMLDivElement, PopoverBackButtonProps>(
  ({ className, folderTitleRef, folderTitleActive, onFolderTitleMouseEnter, ...props }, ref) => {
    const { isInFolder, closeFolder, folderTitle, onFolderSelect, variant } = usePopoverContext()

    if (!isInFolder) {
      return null
    }

    return (
      <div className='flex flex-col'>
        <div
          ref={ref}
          className={cn(POPOVER_ITEM_BASE_CLASSES, POPOVER_ITEM_HOVER_CLASSES[variant], className)}
          role='button'
          onClick={closeFolder}
          {...props}
        >
          <ChevronLeft className='h-3 w-3' />
          <span>Back</span>
        </div>
        {folderTitle && onFolderSelect && (
          <div
            ref={folderTitleRef}
            className={cn(
              POPOVER_ITEM_BASE_CLASSES,
              folderTitleActive
                ? POPOVER_ITEM_ACTIVE_CLASSES[variant]
                : POPOVER_ITEM_HOVER_CLASSES[variant]
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
          <div className='px-[6px] py-[4px] font-base text-[12px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
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
   * Placeholder text for the search input
   * @default 'Search...'
   */
  placeholder?: string
  /**
   * Callback when search query changes
   */
  onValueChange?: (value: string) => void
}

/**
 * Search input component for filtering popover items.
 *
 * @example
 * ```tsx
 * <Popover>
 *   <PopoverContent>
 *     <PopoverSearch placeholder="Search tools..." />
 *     <PopoverScrollArea>
 *       // items
 *     </PopoverScrollArea>
 *   </PopoverContent>
 * </Popover>
 * ```
 */
const PopoverSearch = React.forwardRef<HTMLDivElement, PopoverSearchProps>(
  ({ className, placeholder = 'Search...', onValueChange, ...props }, ref) => {
    const { searchQuery, setSearchQuery } = usePopoverContext()
    const inputRef = React.useRef<HTMLInputElement>(null)

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setSearchQuery(value)
      onValueChange?.(value)
    }

    React.useEffect(() => {
      inputRef.current?.focus()
    }, [])

    return (
      <div ref={ref} className={cn('flex items-center px-[8px] py-[6px]', className)} {...props}>
        <Search className='mr-2 h-[12px] w-[12px] shrink-0 text-[var(--text-muted)]' />
        <input
          ref={inputRef}
          className='w-full bg-transparent font-base text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none'
          placeholder={placeholder}
          value={searchQuery}
          onChange={handleChange}
        />
      </div>
    )
  }
)

PopoverSearch.displayName = 'PopoverSearch'

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
  usePopoverContext,
}
