'use client'

import * as React from 'react'
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import { X } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const AlertDialog = AlertDialogPrimitive.Root

const AlertDialogTrigger = AlertDialogPrimitive.Trigger

const AlertDialogPortal = AlertDialogPrimitive.Portal

// Context for communication between overlay and content
const AlertDialogCloseContext = React.createContext<{
  triggerClose: () => void
} | null>(null)

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, style, onClick, ...props }, ref) => {
  const [isStable, setIsStable] = React.useState(false)
  const closeContext = React.useContext(AlertDialogCloseContext)

  React.useEffect(() => {
    // Add a small delay before allowing overlay interactions to prevent rapid state changes
    const timer = setTimeout(() => setIsStable(true), 150)
    return () => clearTimeout(timer)
  }, [])

  return (
    <AlertDialogPrimitive.Overlay
      className={cn(
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-white/50 data-[state=closed]:animate-out data-[state=open]:animate-in dark:bg-black/50',
        className
      )}
      style={{ backdropFilter: 'blur(1.5px)', ...style }}
      onClick={(e) => {
        // Only allow overlay clicks after component is stable
        if (!isStable) {
          e.preventDefault()
          return
        }
        // Only close if clicking directly on the overlay, not child elements
        if (e.target === e.currentTarget) {
          // Trigger close via context
          closeContext?.triggerClose()
        }
        // Call original onClick if provided
        onClick?.(e)
      }}
      {...props}
      ref={ref}
    />
  )
})
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content> & {
    hideCloseButton?: boolean
  }
>(({ className, children, hideCloseButton = false, ...props }, ref) => {
  const [isInteractionReady, setIsInteractionReady] = React.useState(false)
  const hiddenCancelRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    // Prevent rapid interactions that can cause instability
    const timer = setTimeout(() => setIsInteractionReady(true), 100)
    return () => clearTimeout(timer)
  }, [])

  const closeContextValue = React.useMemo(
    () => ({
      triggerClose: () => hiddenCancelRef.current?.click(),
    }),
    []
  )

  return (
    <AlertDialogPortal>
      <AlertDialogCloseContext.Provider value={closeContextValue}>
        <AlertDialogOverlay />
        <AlertDialogPrimitive.Content
          ref={ref}
          className={cn(
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] fixed top-[50%] left-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 rounded-[8px] border border-[var(--border-muted)] bg-[var(--surface-3)] px-6 py-5 shadow-lg duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in dark:bg-[var(--surface-3)]',
            className
          )}
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
            <AlertDialogPrimitive.Cancel
              className='absolute top-4 right-4 h-4 w-4 border-0 bg-transparent p-0 text-muted-foreground transition-colors hover:bg-transparent hover:bg-transparent hover:text-foreground focus:outline-none disabled:pointer-events-none'
              disabled={!isInteractionReady}
              tabIndex={-1}
            >
              <X className='h-4 w-4' />
              <span className='sr-only'>Close</span>
            </AlertDialogPrimitive.Cancel>
          )}
          {/* Hidden cancel button for overlay clicks */}
          <AlertDialogPrimitive.Cancel
            ref={hiddenCancelRef}
            style={{ display: 'none' }}
            tabIndex={-1}
            aria-hidden='true'
          />
        </AlertDialogPrimitive.Content>
      </AlertDialogCloseContext.Provider>
    </AlertDialogPortal>
  )
})
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-2 text-center sm:text-left', className)} {...props} />
)
AlertDialogHeader.displayName = 'AlertDialogHeader'

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
    {...props}
  />
)
AlertDialogFooter.displayName = 'AlertDialogFooter'

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn('font-semibold text-lg', className)}
    {...props}
  />
))
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn('font-[360] text-sm', className)}
    {...props}
  />
))
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action ref={ref} className={cn(buttonVariants(), className)} {...props} />
))
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(buttonVariants({ variant: 'outline' }), 'mt-2 sm:mt-0', className)}
    {...props}
  />
))
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
