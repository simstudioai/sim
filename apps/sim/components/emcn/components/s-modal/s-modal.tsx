/**
 * Sidebar modal variant with navigation sidebar and main content area.
 *
 * @example
 * ```tsx
 * <SModal>
 *   <SModalContent>
 *     <SModalSidebar>
 *       <SModalSidebarHeader>Settings</SModalSidebarHeader>
 *       <SModalSidebarSection>
 *         <SModalSidebarSectionTitle>Account</SModalSidebarSectionTitle>
 *         <SModalSidebarItem icon={<User />} active>Profile</SModalSidebarItem>
 *         <SModalSidebarItem icon={<Key />}>Security</SModalSidebarItem>
 *       </SModalSidebarSection>
 *     </SModalSidebar>
 *     <SModalMain>
 *       <SModalMainHeader>Profile</SModalMainHeader>
 *       <SModalMainBody>Content here</SModalMainBody>
 *     </SModalMain>
 *   </SModalContent>
 * </SModal>
 * ```
 */

'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'
import { Button } from '../button/button'
import { focusFirstTextInput } from '../modal/auto-focus'
import { Modal, type ModalContentProps, ModalOverlay, ModalPortal } from '../modal/modal'

const ANIMATION_CLASSES =
  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=open]:animate-in motion-reduce:animate-none'

const CONTENT_ANIMATION_CLASSES =
  'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[50%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[50%] motion-reduce:animate-none'

/**
 * Root sidebar modal component.
 */
const SModal = Modal

/**
 * Trigger element that opens the modal.
 */
const SModalTrigger = DialogPrimitive.Trigger

/**
 * Close element that closes the modal.
 */
const SModalClose = DialogPrimitive.Close

/**
 * Modal content with horizontal flex layout.
 */
const SModalContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  ModalContentProps
>(({ className, children, style, onOpenAutoFocus, ...props }, ref) => {
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
          ANIMATION_CLASSES,
          CONTENT_ANIMATION_CLASSES,
          'fixed top-[50%] z-[var(--z-modal)] flex h-[min(calc(100vh-8rem),900px)] min-h-[400px] w-[min(calc(100vw-8rem),1080px)] min-w-[520px] translate-x-[-50%] translate-y-[-50%] flex-row rounded-lg border bg-[var(--bg)] shadow-sm duration-200',
          className
        )}
        style={{
          left: '50%',
          ...style,
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
        onPointerDownOutside={(e) => {
          if (!isInteractionReady) {
            e.preventDefault()
            return
          }
          /**
           * Mirrors ModalContent: an outside click that dismisses an open
           * popper layer (dropdown/select/combobox) must not also close the
           * modal. See modal.tsx for details.
           */
          if (document.querySelector('[data-radix-popper-content-wrapper] [data-state="open"]')) {
            e.preventDefault()
          }
        }}
        onOpenAutoFocus={onOpenAutoFocus ?? focusFirstTextInput}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </ModalPortal>
  )
})

SModalContent.displayName = 'SModalContent'

/**
 * Sidebar container with scrollable content.
 */
const SModalSidebar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex min-h-0 w-[166px] flex-col overflow-y-auto py-3', className)}
      {...props}
    />
  )
)

SModalSidebar.displayName = 'SModalSidebar'

/**
 * Sidebar header with title.
 */
const SModalSidebarHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('mb-4 px-3 font-medium text-[var(--text-primary)] text-md', className)}
      {...props}
    />
  )
)

SModalSidebarHeader.displayName = 'SModalSidebarHeader'

/**
 * Sidebar section container. Groups related items.
 */
const SModalSidebarSection = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1 px-3 [&+&]:mt-3', className)} {...props} />
  )
)

SModalSidebarSection.displayName = 'SModalSidebarSection'

/**
 * Sidebar section title.
 */
const SModalSidebarSectionTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('mb-0.5 font-medium text-[var(--text-muted)] text-caption', className)}
    {...props}
  />
))

SModalSidebarSectionTitle.displayName = 'SModalSidebarSectionTitle'

interface SModalSidebarItemProps extends React.ComponentPropsWithoutRef<typeof Button> {
  /** Whether the item is currently active/selected */
  active?: boolean
  /** Icon element to display */
  icon?: React.ReactNode
}

/**
 * Sidebar item with icon and text. Uses Button component with ghost variant.
 */
function SModalSidebarItem({
  className,
  active,
  icon,
  children,
  ...props
}: SModalSidebarItemProps) {
  return (
    <Button
      variant={active ? 'active' : 'ghost'}
      className={cn(
        'w-full justify-start gap-2 rounded-md border-0 text-small',
        !active &&
          'text-[var(--text-tertiary)] hover-hover:bg-[var(--surface-6)] hover-hover:text-[var(--text-primary)] dark:hover-hover:bg-[var(--border)]',
        className
      )}
      {...props}
    >
      {icon && (
        <span className='size-[14px] flex-shrink-0 [&>svg]:h-full [&>svg]:w-full'>{icon}</span>
      )}
      {children}
    </Button>
  )
}

/**
 * Main content container.
 */
const SModalMain = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex min-w-0 flex-1 flex-col gap-4 overflow-hidden rounded-lg border-l bg-[var(--surface-2)] p-3.5',
        className
      )}
      {...props}
    />
  )
)

SModalMain.displayName = 'SModalMain'

/**
 * Main header with title and close button.
 */
const SModalMainHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center justify-between', className)} {...props}>
      <span className='text-[var(--text-muted)] text-sm'>{children}</span>
      <DialogPrimitive.Close asChild>
        <Button
          variant='ghost'
          className='relative size-[16px] p-0 before:absolute before:inset-[-14px] before:content-[""]'
        >
          <X className='size-[16px]' />
          <span className='sr-only'>Close</span>
        </Button>
      </DialogPrimitive.Close>
    </div>
  )
)

SModalMainHeader.displayName = 'SModalMainHeader'

/**
 * Main body content area.
 */
const SModalMainBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('min-w-0 flex-1 overflow-y-auto overflow-x-hidden', className)}
      {...props}
    />
  )
)

SModalMainBody.displayName = 'SModalMainBody'

export {
  SModal,
  SModalTrigger,
  SModalClose,
  SModalContent,
  SModalSidebar,
  SModalSidebarHeader,
  SModalSidebarSection,
  SModalSidebarSectionTitle,
  SModalSidebarItem,
  SModalMain,
  SModalMainHeader,
  SModalMainBody,
}
