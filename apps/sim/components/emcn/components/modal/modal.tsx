/**
 * Compositional modal component with optional tabs.
 * Uses Radix UI Dialog and Tabs primitives for accessibility.
 * For sidebar modals, use `sidebar-modal.tsx` instead.
 *
 * @example
 * ```tsx
 * // Base modal
 * <Modal>
 *   <ModalTrigger>Open</ModalTrigger>
 *   <ModalContent>
 *     <ModalHeader>Title</ModalHeader>
 *     <ModalBody>Content here</ModalBody>
 *     <ModalFooter>
 *       <Button>Save</Button>
 *     </ModalFooter>
 *   </ModalContent>
 * </Modal>
 *
 * // Modal with tabs
 * <Modal>
 *   <ModalContent>
 *     <ModalHeader>Title</ModalHeader>
 *     <ModalTabs defaultValue="tab1">
 *       <ModalTabsList>
 *         <ModalTabsTrigger value="tab1">Tab 1</ModalTabsTrigger>
 *         <ModalTabsTrigger value="tab2">Tab 2</ModalTabsTrigger>
 *       </ModalTabsList>
 *       <ModalTabsContent value="tab1">Content 1</ModalTabsContent>
 *       <ModalTabsContent value="tab2">Content 2</ModalTabsContent>
 *     </ModalTabs>
 *   </ModalContent>
 * </Modal>
 * ```
 */

'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { X } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/core/utils/cn'
import { Button } from '../button/button'

/**
 * Shared animation classes for modal transitions.
 * Mirrors the legacy `Modal` component to ensure consistent behavior.
 */
const ANIMATION_CLASSES =
  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=open]:animate-in motion-reduce:animate-none'

/**
 * Root modal component. Manages open state.
 */
const Modal = DialogPrimitive.Root

/**
 * Trigger element that opens the modal when clicked.
 */
const ModalTrigger = DialogPrimitive.Trigger

/**
 * Portal component for rendering modal outside DOM hierarchy.
 */
const ModalPortal = DialogPrimitive.Portal

/**
 * Close element that closes the modal when clicked.
 */
const ModalClose = DialogPrimitive.Close

/**
 * Modal overlay component with fade transition.
 * Clicking this overlay closes the dialog via DialogPrimitive.Close.
 */
const ModalOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, style, ...props }, ref) => {
  return (
    <DialogPrimitive.Close asChild>
      <DialogPrimitive.Overlay
        ref={ref}
        className={cn(
          'fixed inset-0 z-[var(--z-modal)] bg-black/10 backdrop-blur-[2px]',
          ANIMATION_CLASSES,
          className
        )}
        style={style}
        {...props}
      />
    </DialogPrimitive.Close>
  )
})

ModalOverlay.displayName = 'ModalOverlay'

/**
 * Modal size variants with responsive viewport-based sizing.
 * Each size uses viewport units with sensible min/max constraints.
 */
const MODAL_SIZES = {
  sm: 'w-[90vw] max-w-[400px]',
  md: 'w-[90vw] max-w-[500px]',
  lg: 'w-[90vw] max-w-[600px]',
  xl: 'w-[90vw] max-w-[800px]',
  full: 'w-[95vw] max-w-[1200px]',
} as const

export type ModalSize = keyof typeof MODAL_SIZES

export interface ModalContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /**
   * Whether to show the close button
   * @default true
   */
  showClose?: boolean
  /**
   * Modal size variant with responsive viewport-based sizing.
   * - sm: max 400px (dialogs, confirmations)
   * - md: max 500px (default, forms)
   * - lg: max 600px (content-heavy modals)
   * - xl: max 800px (complex editors)
   * - full: max 1200px (dashboards, large content)
   * @default 'md'
   */
  size?: ModalSize
}

/**
 * Modal content component with overlay and styled container.
 * Main container that can hold sidebar, header, tabs, and footer.
 */
const ModalContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  ModalContentProps
>(({ className, children, showClose = true, size = 'md', style, ...props }, ref) => {
  const [isInteractionReady, setIsInteractionReady] = React.useState(false)
  const pathname = usePathname()
  const isWorkflowPage = pathname?.includes('/w/') ?? false

  React.useEffect(() => {
    const timer = setTimeout(() => setIsInteractionReady(true), 100)
    return () => clearTimeout(timer)
  }, [])

  return (
    <ModalPortal>
      <ModalOverlay />
      <div
        className='pointer-events-none fixed inset-0 z-[var(--z-modal)] flex items-center justify-center'
        style={{
          paddingLeft: isWorkflowPage
            ? 'calc(var(--sidebar-width) - var(--panel-width))'
            : 'var(--sidebar-width)',
        }}
      >
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            'pointer-events-auto flex max-h-[84vh] flex-col overflow-hidden rounded-xl bg-[var(--bg)] text-small ring-1 ring-foreground/10',
            ANIMATION_CLASSES,
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 duration-200',
            MODAL_SIZES[size],
            className
          )}
          style={style}
          onEscapeKeyDown={(e) => {
            if (!isInteractionReady) {
              e.preventDefault()
              return
            }
            e.stopPropagation()
          }}
          onPointerDown={(e) => {
            e.stopPropagation()
          }}
          onPointerUp={(e) => {
            e.stopPropagation()
          }}
          {...props}
        >
          {children}
        </DialogPrimitive.Content>
      </div>
    </ModalPortal>
  )
})

ModalContent.displayName = 'ModalContent'

/**
 * Modal header component for title and description.
 */
const ModalHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex min-w-0 items-center justify-between gap-2 px-4 pt-4 pb-2', className)}
      {...props}
    >
      <DialogPrimitive.Title className='min-w-0 font-medium text-[var(--text-primary)] text-base leading-none'>
        {children}
      </DialogPrimitive.Title>
      <DialogPrimitive.Close asChild>
        <Button
          variant='ghost'
          className='relative h-[16px] w-[16px] flex-shrink-0 p-0 before:absolute before:inset-[-14px] before:content-[""]'
        >
          <X className='h-[16px] w-[16px]' />
          <span className='sr-only'>Close</span>
        </Button>
      </DialogPrimitive.Close>
    </div>
  )
)

ModalHeader.displayName = 'ModalHeader'

/**
 * Modal title component.
 */
const ModalTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('', className)} {...props} />
))

ModalTitle.displayName = 'ModalTitle'

/**
 * Modal description component.
 */
const ModalDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('', className)} {...props} />
))

ModalDescription.displayName = 'ModalDescription'

/**
 * Modal tabs root component. Wraps tab list and content panels.
 */
const ModalTabs = TabsPrimitive.Root

interface ModalTabsListProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  /** Currently active tab value for indicator positioning */
  activeValue?: string
  /**
   * Whether the tabs are disabled (non-interactive with reduced opacity)
   * @default false
   */
  disabled?: boolean
}

/**
 * Modal tabs list component with animated sliding indicator.
 */
const ModalTabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  ModalTabsListProps
>(({ className, children, activeValue, disabled = false, ...props }, ref) => {
  const listRef = React.useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = React.useState({ left: 0, width: 0 })
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    const list = listRef.current
    if (!list) return

    const updateIndicator = () => {
      const activeTab = list.querySelector('[data-state="active"]') as HTMLElement | null
      if (!activeTab) return

      setIndicator({
        left: activeTab.offsetLeft,
        width: activeTab.offsetWidth,
      })
      setReady(true)
    }

    updateIndicator()

    const observer = new MutationObserver(updateIndicator)
    observer.observe(list, { attributes: true, subtree: true, attributeFilter: ['data-state'] })
    window.addEventListener('resize', updateIndicator)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateIndicator)
    }
  }, [activeValue])

  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        'relative flex gap-4 px-4 pt-1',
        disabled && 'pointer-events-none opacity-50',
        className
      )}
      {...props}
    >
      <div ref={listRef} className='flex gap-4'>
        {children}
      </div>
      <span
        className={cn(
          'pointer-events-none absolute bottom-0 h-[1px] rounded-full bg-[var(--text-primary)]',
          ready ? 'opacity-100 transition-[left,width,opacity] duration-200 ease-out' : 'opacity-0'
        )}
        style={{ left: indicator.left, width: indicator.width }}
      />
    </TabsPrimitive.List>
  )
})

ModalTabsList.displayName = 'ModalTabsList'

/**
 * Modal tab trigger component. Individual tab button.
 */
const ModalTabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'px-1 pb-2 font-medium text-[var(--text-secondary)] text-small transition-colors',
      'hover-hover:text-[var(--text-primary)] data-[state=active]:text-[var(--text-primary)]',
      className
    )}
    {...props}
  />
))

ModalTabsTrigger.displayName = 'ModalTabsTrigger'

/**
 * Modal tab content component. Content panel for each tab.
 * Includes bottom padding for consistent spacing across all tabbed modals.
 */
const ModalTabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('pb-2.5', className)} {...props} />
))

ModalTabsContent.displayName = 'ModalTabsContent'

/**
 * Modal body/content area with background and padding.
 */
const ModalBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex-1 overflow-y-auto px-4 pt-3 pb-4', className)} {...props} />
  )
)

ModalBody.displayName = 'ModalBody'

/**
 * Modal footer component for action buttons.
 */
const ModalFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex justify-end gap-2 rounded-b-xl border-[var(--border)] border-t bg-[color-mix(in_srgb,var(--surface-3)_50%,transparent)] px-4 py-3',
        className
      )}
      {...props}
    />
  )
)

ModalFooter.displayName = 'ModalFooter'

export {
  Modal,
  ModalTrigger,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalTabs,
  ModalTabsList,
  ModalTabsTrigger,
  ModalTabsContent,
  ModalFooter,
  ModalPortal,
  ModalOverlay,
  ModalClose,
  MODAL_SIZES,
}
