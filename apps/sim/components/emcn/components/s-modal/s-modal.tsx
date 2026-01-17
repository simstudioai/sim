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
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { X } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'
import { Button } from '../button/button'
import { Modal, type ModalContentProps, ModalOverlay, ModalPortal } from '../modal/modal'

const ANIMATION_CLASSES =
  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=open]:animate-in'

const CONTENT_ANIMATION_CLASSES =
  'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[50%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[50%]'

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
>(({ className, children, style, ...props }, ref) => {
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
          'fixed top-[50%] left-[50%] z-[500] flex h-[min(calc(100vh-8rem),900px)] min-h-[400px] w-[min(calc(100vw-8rem),1080px)] min-w-[520px] translate-x-[-50%] translate-y-[-50%] flex-row rounded-[8px] border bg-[var(--bg)] shadow-sm duration-200',
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
      className={cn('flex min-h-0 w-[166px] flex-col overflow-y-auto py-[12px]', className)}
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
      className={cn(
        'mb-[16px] px-[12px] font-medium text-[16px] text-[var(--text-primary)]',
        className
      )}
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
    <div
      ref={ref}
      className={cn('flex flex-col gap-[4px] px-[12px] [&+&]:mt-[12px]', className)}
      {...props}
    />
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
    className={cn('mb-[2px] font-medium text-[12px] text-[var(--text-muted)]', className)}
    {...props}
  />
))

SModalSidebarSectionTitle.displayName = 'SModalSidebarSectionTitle'

export interface SModalSidebarItemProps extends React.ComponentPropsWithoutRef<typeof Button> {
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
        'w-full justify-start gap-[8px] rounded-[6px] border-0 text-[13px]',
        !active &&
          'text-[var(--text-tertiary)] hover:bg-[var(--surface-6)] hover:text-[var(--text-primary)] dark:hover:bg-[var(--border)]',
        className
      )}
      {...props}
    >
      {icon && (
        <span className='h-[14px] w-[14px] flex-shrink-0 [&>svg]:h-full [&>svg]:w-full'>
          {icon}
        </span>
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
        'flex min-w-0 flex-1 flex-col gap-[16px] overflow-hidden rounded-[8px] border-l bg-[var(--surface-2)] p-[14px]',
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
      <span className='font-base text-[14px] text-[var(--text-muted)]'>{children}</span>
      <DialogPrimitive.Close asChild>
        <Button variant='ghost' className='h-[16px] w-[16px] p-0'>
          <X className='h-[16px] w-[16px]' />
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

/**
 * Sidebar modal tabs root component.
 */
const SModalTabs = TabsPrimitive.Root

interface SModalTabsListProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  /** Currently active tab value for indicator positioning */
  activeValue?: string
  /**
   * Whether the tabs are disabled (non-interactive with reduced opacity)
   * @default false
   */
  disabled?: boolean
}

/**
 * Sidebar modal tabs list component with animated indicator.
 */
const SModalTabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  SModalTabsListProps
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
        'relative flex gap-[16px] px-4',
        disabled && 'pointer-events-none opacity-50',
        className
      )}
      {...props}
    >
      <div ref={listRef} className='flex gap-[16px]'>
        {children}
      </div>
      <span
        className={cn(
          'pointer-events-none absolute bottom-0 h-[1px] rounded-full bg-[var(--text-primary)]',
          ready && 'transition-all duration-200 ease-out'
        )}
        style={{ left: indicator.left, width: indicator.width }}
      />
    </TabsPrimitive.List>
  )
})

SModalTabsList.displayName = 'SModalTabsList'

/**
 * Sidebar modal tab trigger component.
 */
const SModalTabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'px-1 pb-[8px] font-medium text-[13px] text-[var(--text-secondary)] transition-colors',
      'hover:text-[var(--text-primary)] data-[state=active]:text-[var(--text-primary)]',
      className
    )}
    {...props}
  />
))

SModalTabsTrigger.displayName = 'SModalTabsTrigger'

/**
 * Sidebar modal tab content component.
 */
const SModalTabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('pb-[10px]', className)} {...props} />
))

SModalTabsContent.displayName = 'SModalTabsContent'

/**
 * Sidebar modal tabs body container with border-top divider.
 * Wraps tab content panels to provide consistent styling with ModalBody.
 */
const SModalTabsBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'min-h-0 flex-1 overflow-y-auto border-[var(--border)] border-t pt-[10px]',
        className
      )}
      {...props}
    />
  )
)

SModalTabsBody.displayName = 'SModalTabsBody'

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
  SModalTabs,
  SModalTabsList,
  SModalTabsTrigger,
  SModalTabsContent,
  SModalTabsBody,
}
