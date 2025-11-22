/**
 * Compositional modal component with optional sidebar and tabs.
 * Uses Radix UI Dialog and Tabs primitives for accessibility.
 *
 * @example
 * ```tsx
 * // Base modal
 * <Modal>
 *   <ModalTrigger>Open</ModalTrigger>
 *   <ModalContent>
 *     <ModalHeader>
 *       <ModalTitle>Title</ModalTitle>
 *     </ModalHeader>
 *   </ModalContent>
 * </Modal>
 *
 * // Modal with sidebar and tabs
 * <Modal>
 *   <ModalContent>
 *     <ModalSidebar>Sidebar content</ModalSidebar>
 *     <ModalHeader>
 *       <ModalTitle>Title</ModalTitle>
 *     </ModalHeader>
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
import { cn } from '@/lib/utils'
import { Button } from '../button/button'

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
 * Modal overlay component with stability handling.
 */
const ModalOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, style, ...props }, ref) => {
  const [isStable, setIsStable] = React.useState(false)

  React.useEffect(() => {
    const timer = setTimeout(() => setIsStable(true), 150)
    return () => clearTimeout(timer)
  }, [])

  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn('fixed inset-0 z-50', className)}
      style={style}
      onPointerDown={(e) => {
        if (!isStable) {
          e.preventDefault()
          return
        }
        if (e.target !== e.currentTarget) {
          e.preventDefault()
        }
      }}
      {...props}
    />
  )
})

ModalOverlay.displayName = 'ModalOverlay'

export interface ModalContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /**
   * Whether to show the close button
   * @default true
   */
  showClose?: boolean
}

/**
 * Modal content component with overlay and styled container.
 * Main container that can hold sidebar, header, tabs, and footer.
 */
const ModalContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  ModalContentProps
>(({ className, children, showClose = true, style, ...props }, ref) => {
  const [isInteractionReady, setIsInteractionReady] = React.useState(false)

  React.useEffect(() => {
    const timer = setTimeout(() => setIsInteractionReady(true), 100)
    return () => clearTimeout(timer)
  }, [])

  return (
    <ModalPortal>
      <ModalOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          '-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex max-h-[80vh] min-w-[30vw] flex-col rounded-[8px] border bg-[#1E1E1E]',
          className
        )}
        style={style}
        onInteractOutside={(e) => {
          if (!isInteractionReady) {
            e.preventDefault()
            return
          }
          const target = e.target as Element
          if (target.closest('[role="dialog"]')) {
            e.preventDefault()
          }
        }}
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
    </ModalPortal>
  )
})

ModalContent.displayName = 'ModalContent'

/**
 * Modal sidebar component. Appears on the left side of the modal.
 */
const ModalSidebar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('', className)} {...props} />
)

ModalSidebar.displayName = 'ModalSidebar'

/**
 * Modal header component for title and description.
 */
const ModalHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center justify-between px-[16px] py-[10px]', className)}
      {...props}
    >
      <DialogPrimitive.Title className='font-medium text-[#FFFFFF] text-[16px]'>
        {children}
      </DialogPrimitive.Title>
      <DialogPrimitive.Close asChild>
        <Button variant='ghost' className='h-[16px] w-[16px] p-0'>
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
 * Modal body/content area with background and padding.
 */
const ModalBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex-1 overflow-y-auto rounded-t-[8px] border-t bg-[#232323] px-[14px] pt-[10px] pb-[20px]',
        className
      )}
      {...props}
    />
  )
)

ModalBody.displayName = 'ModalBody'

/**
 * Modal tabs root component. Wraps tab list and content panels.
 */
const ModalTabs = TabsPrimitive.Root

/**
 * Modal tabs list component. Container for tab triggers.
 */
const ModalTabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List ref={ref} className={cn('flex', className)} {...props} />
))

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
      'relative px-0 py-0 text-[12px] text-[var(--text-secondary)]',
      'after:absolute after:right-0 after:bottom-0 after:left-0 after:h-[8px] after:bg-transparent',
      'data-[state=active]:text-[#FFFFFF] data-[state=active]:after:bg-[#FFFFFF]',
      className
    )}
    {...props}
  />
))

ModalTabsTrigger.displayName = 'ModalTabsTrigger'

/**
 * Modal tab content component. Content panel for each tab.
 */
const ModalTabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('', className)} {...props} />
))

ModalTabsContent.displayName = 'ModalTabsContent'

/**
 * Modal footer component for action buttons.
 */
const ModalFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex justify-end gap-[8px] rounded-b-[8px] border-t bg-[#232323] px-[16px] py-[10px]',
        className
      )}
      {...props}
    />
  )
)

ModalFooter.displayName = 'ModalFooter'

export {
  Modal,
  ModalPortal,
  ModalOverlay,
  ModalTrigger,
  ModalClose,
  ModalContent,
  ModalSidebar,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalTabs,
  ModalTabsList,
  ModalTabsTrigger,
  ModalTabsContent,
  ModalFooter,
}
