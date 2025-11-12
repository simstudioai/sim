/**
 * Minimal modal component following emcn design system styling.
 * Uses Radix UI Dialog primitives for accessibility.
 *
 * @example
 * ```tsx
 * import { Modal, ModalTrigger, ModalContent, ModalHeader, ModalTitle, ModalDescription, ModalFooter } from '@/components/emcn'
 *
 * function MyComponent() {
 *   const [open, setOpen] = useState(false)
 *
 *   return (
 *     <Modal open={open} onOpenChange={setOpen}>
 *       <ModalTrigger asChild>
 *         <button>Open Modal</button>
 *       </ModalTrigger>
 *       <ModalContent>
 *         <ModalHeader>
 *           <ModalTitle>Delete workflow?</ModalTitle>
 *           <ModalDescription>
 *             This action cannot be undone.
 *           </ModalDescription>
 *         </ModalHeader>
 *         <ModalFooter>
 *           <button onClick={() => setOpen(false)}>Cancel</button>
 *           <button onClick={handleDelete}>Delete</button>
 *         </ModalFooter>
 *       </ModalContent>
 *     </Modal>
 *   )
 * }
 * ```
 */

'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Modal z-index configuration
 */
const MODAL_Z_INDEX = 9999999

/**
 * Modal sizing constants
 */
const MODAL_SIZING = {
  MAX_WIDTH: 'max-w-[400px]',
  BORDER_RADIUS: 'rounded-[8px]',
  CLOSE_BUTTON_RADIUS: 'rounded-[4px]',
} as const

/**
 * Modal spacing constants
 */
const MODAL_SPACING = {
  CONTENT_PADDING: 'p-[12px]',
  CONTENT_GAP: 'gap-[12px]',
  HEADER_GAP: 'gap-[8px]',
  FOOTER_GAP: 'gap-[8px]',
  CLOSE_BUTTON_POSITION: 'top-[12px] right-[12px]',
} as const

/**
 * Modal color constants
 */
const MODAL_COLORS = {
  OVERLAY_BG: 'bg-black/80',
  CONTENT_BG: 'bg-[var(--surface-3)] dark:bg-[var(--surface-3)]',
  TITLE_TEXT: 'text-[var(--text-primary)] dark:text-[var(--text-primary)]',
  DESCRIPTION_TEXT: 'text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]',
  CLOSE_BUTTON_TEXT: 'text-[var(--text-secondary)] dark:text-[var(--text-secondary)]',
} as const

/**
 * Modal typography constants
 */
const MODAL_TYPOGRAPHY = {
  TITLE_SIZE: 'text-[14px]',
  DESCRIPTION_SIZE: 'text-[12px]',
} as const

/**
 * Shared animation classes for modal transitions
 */
const ANIMATION_CLASSES =
  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=open]:animate-in'

/**
 * Modal content animation classes
 */
const CONTENT_ANIMATION_CLASSES =
  'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]'

/**
 * Root modal component. Manages open state.
 */
const Modal = DialogPrimitive.Root

/**
 * Trigger element that opens the modal when clicked.
 */
const ModalTrigger = DialogPrimitive.Trigger

/**
 * Close element that closes the modal when clicked.
 */
const ModalClose = DialogPrimitive.Close

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
 */
const ModalContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  ModalContentProps
>(({ className, children, showClose = true, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      className={cn('fixed inset-0', ANIMATION_CLASSES, MODAL_COLORS.OVERLAY_BG)}
      style={{ zIndex: MODAL_Z_INDEX }}
    />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Animation classes
        ANIMATION_CLASSES,
        CONTENT_ANIMATION_CLASSES,
        // Layout
        'fixed top-[50%] left-[50%] flex w-full translate-x-[-50%] translate-y-[-50%] flex-col',
        // Sizing
        MODAL_SIZING.MAX_WIDTH,
        MODAL_SIZING.BORDER_RADIUS,
        // Spacing
        MODAL_SPACING.CONTENT_PADDING,
        MODAL_SPACING.CONTENT_GAP,
        // Colors
        MODAL_COLORS.CONTENT_BG,
        // Transitions
        'shadow-lg duration-200',
        className
      )}
      style={{ zIndex: MODAL_Z_INDEX }}
      {...props}
    >
      {children}
      {showClose && (
        <DialogPrimitive.Close
          className={cn(
            'absolute opacity-70 transition-opacity hover:opacity-100 focus:outline-none disabled:pointer-events-none',
            MODAL_SPACING.CLOSE_BUTTON_POSITION,
            MODAL_SIZING.CLOSE_BUTTON_RADIUS,
            MODAL_COLORS.CLOSE_BUTTON_TEXT
          )}
        >
          <X className='h-4 w-4' />
          <span className='sr-only'>Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
))

ModalContent.displayName = 'ModalContent'

/**
 * Modal header component for title and description.
 */
const ModalHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col', MODAL_SPACING.HEADER_GAP, className)}
      {...props}
    />
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
  <DialogPrimitive.Title
    ref={ref}
    className={cn('font-medium', MODAL_TYPOGRAPHY.TITLE_SIZE, MODAL_COLORS.TITLE_TEXT, className)}
    {...props}
  />
))

ModalTitle.displayName = 'ModalTitle'

/**
 * Modal description component.
 */
const ModalDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn(
      'font-base',
      MODAL_TYPOGRAPHY.DESCRIPTION_SIZE,
      MODAL_COLORS.DESCRIPTION_TEXT,
      className
    )}
    {...props}
  />
))

ModalDescription.displayName = 'ModalDescription'

/**
 * Modal footer component for action buttons.
 */
const ModalFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex justify-between', MODAL_SPACING.FOOTER_GAP, className)}
      {...props}
    />
  )
)

ModalFooter.displayName = 'ModalFooter'

export {
  Modal,
  ModalTrigger,
  ModalClose,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalFooter,
}
