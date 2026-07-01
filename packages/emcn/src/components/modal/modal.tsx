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
import { cn } from '../../lib/cn'
import { Button } from '../button/button'
import { focusFirstTextInput, focusFirstTextInputIn } from './auto-focus'

/**
 * Shared animation classes for modal transitions.
 * Mirrors the legacy `Modal` component to ensure consistent behavior.
 */
const ANIMATION_CLASSES =
  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=open]:animate-in motion-reduce:animate-none'

function hasOpenFloatingLayer() {
  return Boolean(document.querySelector('[data-radix-popper-content-wrapper] [data-state="open"]'))
}

/**
 * Clears a stale `pointer-events: none` lock Radix can leave on `<body>` when
 * this dialog closes while a nested modal popper (an open `ChipDropdown` /
 * `Select`) is still open: both layers' body locks tear down in the same tick
 * and the release is lost, freezing the page so nothing is clickable.
 *
 * Rendered INSIDE `DialogPrimitive.Content` so it unmounts exactly when the
 * dialog closes (Radix `Presence`), unlike `ModalContent` which consumers keep
 * mounted across open/close. The check is deferred a frame so it runs after
 * Radix's own teardown, and only clears the lock when no other dialog remains
 * open (nested modals keep theirs). Outside a dialog, EMCN poppers are
 * non-modal and never lock the body, so a surviving lock is always stale.
 */
function ModalBodyLockReleaser() {
  React.useEffect(() => {
    return () => {
      requestAnimationFrame(() => {
        if (document.body.style.pointerEvents !== 'none') return
        const anotherDialogOpen = document.querySelector(
          '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
        )
        if (!anotherDialogOpen) {
          document.body.style.pointerEvents = ''
        }
      })
    }
  }, [])
  return null
}

/**
 * Whether the current subtree renders inside a `ModalContent`.
 *
 * Floating EMCN controls (e.g. `ChipDropdown`) read this to switch their
 * Radix popper to modal behavior. A non-modal popper portaled to `body`
 * underneath a modal dialog inherits the dialog's `pointer-events: none`
 * body lock and its outside-scroll lock, leaving the popper unclickable and
 * unscrollable; a modal popper pauses the dialog's focus trap and carries
 * its own scroll allowance.
 */
const InsideModalContext = React.createContext(false)

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
 * Outside interactions are handled by the dialog content so nested poppers can
 * close without also dismissing the modal.
 *
 * `[transform:translateZ(0)]` forces the overlay onto its own compositing layer.
 * A `backdrop-blur` overlay does not reliably paint above page content the
 * browser has already GPU-promoted — `position: sticky` headers and `z-index`ed
 * absolutes inside a scroll container (e.g. the scheduled-tasks calendar) can
 * sort ABOVE it despite its higher `z-index`, bleeding through. Promoting the
 * overlay (and the content wrapper below, so the panel occludes too) makes the
 * compositor honor stacking order.
 */
const ModalOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, style, ...props }, ref) => {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        'fixed inset-0 z-[var(--z-modal)] bg-black/10 backdrop-blur-[2px] [transform:translateZ(0)]',
        ANIMATION_CLASSES,
        className
      )}
      style={style}
      {...props}
    />
  )
})

ModalOverlay.displayName = 'ModalOverlay'

/**
 * Modal size variants with responsive viewport-based sizing.
 * Each size uses viewport units with sensible min/max constraints.
 */
const MODAL_SIZES = {
  sm: 'w-[90vw] max-w-[440px]',
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
   * - sm: max 440px (dialogs, confirmations)
   * - md: max 500px (default, forms)
   * - lg: max 600px (content-heavy modals)
   * - xl: max 800px (complex editors)
   * - full: max 1200px (dashboards, large content)
   *
   * Sizes up to `xl` center within the content area (offset for the sidebar,
   * and the panel on workflow pages). `full` modals span most of the viewport,
   * so they center against the full viewport instead.
   * @default 'md'
   */
  size?: ModalSize
  /**
   * Strips the modal's default visual chrome (background, ring, rounded
   * corners, overflow clip) so a custom surface nested inside can fully own
   * its appearance. Useful when wrapping a self-styled panel like
   * `ChipModal`. Modal mechanics (overlay, focus trap, ESC, animations)
   * remain intact.
   *
   * When `bare` is `true`, pass `srTitle` to keep the dialog accessible —
   * there's no visible `ModalHeader` providing a title.
   * @default false
   */
  bare?: boolean
  /**
   * Screen-reader-only title rendered as a hidden `DialogPrimitive.Title`.
   * Pair with `bare` to satisfy Radix's accessibility contract when no
   * visible `ModalHeader` is rendered. Without it, Radix's focus management
   * can fall into states where the dialog can't be re-opened cleanly.
   */
  srTitle?: string
}

/**
 * Modal content component with overlay and styled container.
 * Main container that can hold sidebar, header, tabs, and footer.
 */
const ModalContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  ModalContentProps
>(
  (
    {
      className,
      children,
      showClose = true,
      size = 'md',
      bare = false,
      srTitle,
      style,
      onOpenAutoFocus,
      'aria-describedby': ariaDescribedBy,
      ...props
    },
    ref
  ) => {
    const pathname = usePathname()
    const isWorkflowPage = pathname?.includes('/w/') ?? false

    return (
      <ModalPortal>
        <ModalOverlay />
        <div
          className='pointer-events-none fixed inset-0 z-[var(--z-modal)] flex items-center justify-center [transform:translateZ(0)]'
          style={
            size === 'full'
              ? undefined
              : {
                  paddingLeft: isWorkflowPage
                    ? 'calc(var(--sidebar-width) - var(--panel-width))'
                    : 'var(--sidebar-width)',
                }
          }
        >
          <DialogPrimitive.Content
            ref={ref}
            className={cn(
              'pointer-events-auto flex max-h-[84vh] flex-col text-small',
              !bare && 'overflow-hidden rounded-xl bg-[var(--bg)] ring-1 ring-foreground/10',
              ANIMATION_CLASSES,
              'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 duration-200',
              MODAL_SIZES[size],
              className
            )}
            style={style}
            onEscapeKeyDown={(e) => {
              e.stopPropagation()
            }}
            onPointerDown={(e) => {
              e.stopPropagation()
            }}
            onPointerUp={(e) => {
              e.stopPropagation()
            }}
            onInteractOutside={(e) => {
              /**
               * Radix dispatches outside-interaction events to every open
               * layer at once, so a click that should only dismiss an open
               * dropdown / select / combobox (portaled into a popper wrapper
               * above this modal) would also close the modal — both via the
               * pointer event and via the transient focus shift when the
               * popper's focus scope unwinds (`focusOutside`). Worse, the
               * modal and the popper tearing down their body pointer-events
               * locks in the same tick can leave the page frozen. Keep the
               * modal open and let the interaction dismiss just the popper
               * layer. The `data-state="open"` filter ignores poppers that
               * are merely animating closed, so a follow-up click during the
               * exit animation still dismisses the modal.
               */
              if (hasOpenFloatingLayer()) {
                e.preventDefault()
              }
            }}
            onOpenAutoFocus={onOpenAutoFocus ?? focusFirstTextInput}
            aria-describedby={ariaDescribedBy}
            {...props}
          >
            <ModalBodyLockReleaser />
            {srTitle ? (
              <DialogPrimitive.Title className='sr-only'>{srTitle}</DialogPrimitive.Title>
            ) : null}
            <InsideModalContext.Provider value={true}>{children}</InsideModalContext.Provider>
          </DialogPrimitive.Content>
        </div>
      </ModalPortal>
    )
  }
)

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
          className='relative size-[16px] flex-shrink-0 p-0 before:absolute before:inset-[-14px] before:content-[""]'
        >
          <X className='size-[16px]' />
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
  <DialogPrimitive.Title ref={ref} className={className} {...props} />
))

ModalTitle.displayName = 'ModalTitle'

/**
 * Modal description component.
 */
const ModalDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={className} {...props} />
))

ModalDescription.displayName = 'ModalDescription'

/**
 * Modal tabs root component. Wraps tab list and content panels.
 */
const ModalTabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>(({ onValueChange, ...props }, ref) => {
  const rootRef = React.useRef<HTMLDivElement>(null)
  React.useImperativeHandle(ref, () => rootRef.current as HTMLDivElement, [])

  const handleValueChange = (value: string) => {
    onValueChange?.(value)
    window.requestAnimationFrame(() => {
      const root = rootRef.current
      if (!root) return
      const panel = root.querySelector<HTMLElement>('[role="tabpanel"][data-state="active"]')
      focusFirstTextInputIn(panel)
    })
  }

  return <TabsPrimitive.Root ref={rootRef} onValueChange={handleValueChange} {...props} />
})

ModalTabs.displayName = 'ModalTabs'

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
 *
 * When this panel mounts (i.e. its tab becomes active), focus moves to the first
 * visible text-entry input inside it so typing works immediately. Tabs with no
 * text input are untouched.
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
  InsideModalContext,
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
