'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, style, ...props }, ref) => {
  const [isStable, setIsStable] = React.useState(false)

  React.useEffect(() => {
    // Add a small delay before allowing overlay interactions to prevent rapid state changes
    const timer = setTimeout(() => setIsStable(true), 150)
    return () => clearTimeout(timer)
  }, [])

  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-white/50 data-[state=closed]:animate-out data-[state=open]:animate-in dark:bg-black/50',
        className
      )}
      style={{ backdropFilter: 'blur(1.5px)', ...style }}
      onPointerDown={(e) => {
        // Only allow overlay clicks after component is stable
        if (!isStable) {
          e.preventDefault()
          return
        }
        // Ensure click is on the overlay itself, not a child
        if (e.target !== e.currentTarget) {
          e.preventDefault()
        }
      }}
      {...props}
    />
  )
})
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    hideCloseButton?: boolean
  }
>(({ className, children, hideCloseButton = false, ...props }, ref) => {
  const [isInteractionReady, setIsInteractionReady] = React.useState(false)

  React.useEffect(() => {
    // Prevent rapid interactions that can cause instability
    const timer = setTimeout(() => setIsInteractionReady(true), 100)
    return () => clearTimeout(timer)
  }, [])

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] fixed top-[50%] left-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 rounded-[8px] border border-[var(--border-muted)] bg-[var(--surface-3)] p-6 shadow-lg duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in dark:bg-[var(--surface-3)]',
          className
        )}
        onInteractOutside={(e) => {
          // Prevent accidental closes from child element interactions during initial render
          if (!isInteractionReady) {
            e.preventDefault()
            return
          }
          // More restrictive interaction outside handling
          const target = e.target as Element
          if (target.closest('[role="dialog"]')) {
            e.preventDefault()
          }
        }}
        onEscapeKeyDown={(e) => {
          // Prevent escape during rapid interactions
          if (!isInteractionReady) {
            e.preventDefault()
            return
          }
          // Allow escape but prevent event bubbling issues
          e.stopPropagation()
        }}
        onPointerDown={(e) => {
          // Prevent event bubbling that might interfere with parent hover states
          e.stopPropagation()
        }}
        onPointerUp={(e) => {
          // Prevent event bubbling that might interfere with parent hover states
          e.stopPropagation()
        }}
        {...props}
      >
        {children}
        {!hideCloseButton && (
          <DialogPrimitive.Close
            className='absolute top-4 right-4 h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus:outline-none disabled:pointer-events-none'
            disabled={!isInteractionReady}
            tabIndex={-1}
          >
            <X className='h-4 w-4' />
            <span className='sr-only'>Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
)
DialogHeader.displayName = 'DialogHeader'

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
    {...props}
  />
)
DialogFooter.displayName = 'DialogFooter'

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('font-medium text-lg leading-none tracking-tight', className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-muted-foreground text-sm', className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
