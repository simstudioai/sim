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
import { usePathname } from 'next/navigation'
import { X } from '../../icons'
import { cn } from '../../lib/cn'
import { Button } from '../button/button'
import { focusFirstTextInput, focusFirstTextInputIn } from './auto-focus'

/**
 * Shared animation classes for modal transitions.
 * Mirrors the legacy `Modal` component to ensure consistent behavior.
 */
const ANIMATION_CLASSES =
  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=open]:animate-in motion-reduce:animate-none'

/**
 * Renderer layers announce themselves before becoming visible so native
 * surfaces (for example Electron WebContentsViews) can move behind the effect
 * before its first painted frame.
 */
export const NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT = 'sim:native-surface-occlusion-prepare'

export interface NativeSurfaceOcclusionPrepareDetail {
  kind: 'modal' | 'takeover'
  waitUntil: (preparation: Promise<unknown>) => void
}

interface NativeSurfaceOcclusionPreparation {
  completion: Promise<void>
  cancel: () => void
}

const PENDING_NATIVE_INTERACTION_EVENTS = [
  'beforeinput',
  'compositionstart',
  'compositionupdate',
  'compositionend',
  'keydown',
  'keypress',
  'keyup',
  'paste',
  'cut',
] as const

let pendingNativeInteractionLocks = 0
let pendingNativeInteractionSentinel: HTMLSpanElement | null = null

const blockPendingNativeInteraction = (event: Event) => {
  event.preventDefault()
  event.stopImmediatePropagation()
}

/**
 * Pointer coverage alone is insufficient while an atomic preparation waits:
 * keyboard events and global shortcuts otherwise keep firing through an
 * invisible modal. When the native WebContents owns focus, the renderer sees
 * `<body>` as active, so a sentinel also pulls keyboard ownership back into
 * Sim. A real renderer control remains focused: Radix can then remember and
 * restore the correct trigger when the modal closes. This lock exists only
 * when a native listener actually claims the barrier, so ordinary web modals
 * retain their exact historical focus and keyboard behavior.
 */
function acquirePendingNativeInteractionLock(): () => void {
  pendingNativeInteractionLocks++
  if (pendingNativeInteractionLocks === 1) {
    for (const type of PENDING_NATIVE_INTERACTION_EVENTS) {
      window.addEventListener(type, blockPendingNativeInteraction, true)
    }
    const activeElement = document.activeElement
    if (
      activeElement === null ||
      activeElement === document.body ||
      activeElement === document.documentElement
    ) {
      const sentinel = document.createElement('span')
      sentinel.tabIndex = -1
      sentinel.dataset.nativeSurfaceInteractionSentinel = ''
      Object.assign(sentinel.style, {
        height: '1px',
        opacity: '0',
        pointerEvents: 'none',
        position: 'fixed',
        width: '1px',
      })
      document.body.appendChild(sentinel)
      sentinel.focus({ preventScroll: true })
      pendingNativeInteractionSentinel = sentinel
    }
  }

  let released = false
  return () => {
    if (released) return
    released = true
    pendingNativeInteractionLocks = Math.max(0, pendingNativeInteractionLocks - 1)
    if (pendingNativeInteractionLocks !== 0) return
    for (const type of PENDING_NATIVE_INTERACTION_EVENTS) {
      window.removeEventListener(type, blockPendingNativeInteraction, true)
    }
    pendingNativeInteractionSentinel?.remove()
    pendingNativeInteractionSentinel = null
  }
}

/**
 * Dispatches a synchronous preparation request and returns `null` when no
 * native surface claimed it. Once claimed, preparation is an atomic barrier:
 * every listener must fulfill before the renderer surface can become visible.
 * A pending or rejected claim deliberately leaves the surface hidden rather
 * than exposing an unoccluded native surface underneath it.
 */
function requestNativeSurfaceOcclusionPreparation(
  kind: NativeSurfaceOcclusionPrepareDetail['kind']
): NativeSurfaceOcclusionPreparation | null {
  const preparations: Promise<unknown>[] = []
  const detail: NativeSurfaceOcclusionPrepareDetail = {
    kind,
    waitUntil: (preparation) => preparations.push(Promise.resolve(preparation)),
  }
  window.dispatchEvent(
    new CustomEvent<NativeSurfaceOcclusionPrepareDetail>(NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT, {
      detail,
    })
  )
  if (preparations.length === 0) return null
  const releaseInteractionLock = acquirePendingNativeInteractionLock()
  let releaseFrame: number | null = null
  const completion = Promise.all(preparations).then(() => undefined)
  // Keep keyboard input blocked through the first ready paint. The modal's
  // layout effect can move focus into its real content before interaction is
  // re-enabled; rejected preparation deliberately remains fail-closed until
  // the owning surface unmounts and calls `cancel`.
  void completion.then(
    () => {
      releaseFrame = requestAnimationFrame(() => {
        releaseFrame = null
        releaseInteractionLock()
      })
    },
    () => {}
  )
  return {
    completion,
    cancel: () => {
      if (releaseFrame !== null) cancelAnimationFrame(releaseFrame)
      releaseFrame = null
      releaseInteractionLock()
    },
  }
}

/**
 * Pre-paint readiness for custom modal/takeover surfaces that do not use
 * `ModalContent`. Keep the surface mounted but visually hidden until this is
 * true; marker attributes should still reflect `active` so closing can release
 * the browser lease.
 */
export function useNativeSurfaceOcclusionReady(
  active: boolean,
  kind: NativeSurfaceOcclusionPrepareDetail['kind']
): boolean {
  const [ready, setReady] = React.useState(false)

  React.useLayoutEffect(() => {
    if (!active) {
      setReady(false)
      return
    }
    let current = true
    setReady(false)
    const preparation = requestNativeSurfaceOcclusionPreparation(kind)
    if (!preparation) {
      setReady(true)
      return
    }
    void preparation.completion.then(
      () => {
        if (current) setReady(true)
      },
      () => {
        // A failed native-surface transition is unsafe to reveal through.
      }
    )
    return () => {
      current = false
      preparation.cancel()
    }
  }, [active, kind])

  return active && ready
}

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
 * Broadcasts {@link ModalContentProps.dismissDisabled} to every dismiss control
 * in the subtree, so a modal states the interlock once on the content rather
 * than each button remembering to disable itself.
 */
const ModalDismissDisabledContext = React.createContext(false)

/**
 * Whether an enclosing modal is currently refusing dismissal. Dismiss controls
 * (a close X, a Cancel) should disable themselves when this is `true`.
 */
export function useModalDismissDisabled(): boolean {
  return React.useContext(ModalDismissDisabledContext)
}

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

interface NativeSurfaceModalGateProps {
  barrierClaimedRef: React.MutableRefObject<boolean>
  onReadyChange: (ready: boolean) => void
}

/**
 * Mounts inside Radix Presence, so preparation starts only when this particular
 * modal actually opens. Layout effects run before the first paint: the overlay
 * and dialog remain hidden while listeners replace/hide any native surfaces,
 * then their normal open animations start together. With no listener (web, or
 * a renderer-owned terminal) readiness is restored in the same pre-paint pass.
 */
function NativeSurfaceModalGate({ barrierClaimedRef, onReadyChange }: NativeSurfaceModalGateProps) {
  React.useLayoutEffect(() => {
    let active = true

    onReadyChange(false)
    const preparation = requestNativeSurfaceOcclusionPreparation('modal')
    barrierClaimedRef.current = preparation !== null
    if (!preparation) {
      onReadyChange(true)
    } else {
      void preparation.completion.then(
        () => {
          if (active) onReadyChange(true)
        },
        () => {
          // A failed native-surface transition is unsafe to reveal through.
        }
      )
    }

    return () => {
      active = false
      barrierClaimedRef.current = false
      preparation?.cancel()
    }
  }, [barrierClaimedRef, onReadyChange])

  return null
}

interface ModalOverlayProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> {
  nativeSurfaceBarrierClaimedRef?: React.MutableRefObject<boolean>
  nativeSurfaceReady?: boolean
  onNativeSurfaceReadyChange?: (ready: boolean) => void
}

/**
 * Modal overlay component with fade transition.
 * Outside interactions are handled by the dialog content so nested poppers can
 * close without also dismissing the modal.
 */
const ModalOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  ModalOverlayProps
>(
  (
    {
      className,
      style,
      nativeSurfaceBarrierClaimedRef,
      nativeSurfaceReady = true,
      onNativeSurfaceReadyChange,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <DialogPrimitive.Overlay
        ref={ref}
        className={cn(
          'fixed inset-0 z-[var(--z-modal)] bg-black/10 backdrop-blur-[2px]',
          ANIMATION_CLASSES,
          !nativeSurfaceReady && 'data-[state=open]:[animation-play-state:paused]',
          className
        )}
        style={{
          ...style,
          visibility: nativeSurfaceReady ? style?.visibility : 'hidden',
        }}
        {...props}
        data-native-surface-overlay=''
        data-native-surface-occlusion='modal'
      >
        {onNativeSurfaceReadyChange && nativeSurfaceBarrierClaimedRef ? (
          <NativeSurfaceModalGate
            barrierClaimedRef={nativeSurfaceBarrierClaimedRef}
            onReadyChange={onNativeSurfaceReadyChange}
          />
        ) : null}
        {children}
      </DialogPrimitive.Overlay>
    )
  }
)

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
  /**
   * Refuses every dismissal while an action is in flight: the Escape key,
   * clicking outside, and `ModalHeader`'s close button. Descendants read it via
   * {@link useModalDismissDisabled}.
   *
   * A consumer's own `onEscapeKeyDown` / `onInteractOutside` runs after this
   * guard rather than replacing it, so neither the interlock nor the
   * floating-layer guard can be dropped by passing a handler.
   * @default false
   */
  dismissDisabled?: boolean
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
      dismissDisabled = false,
      style,
      onOpenAutoFocus,
      onEscapeKeyDown,
      onInteractOutside,
      'aria-describedby': ariaDescribedBy,
      ...props
    },
    ref
  ) => {
    const pathname = usePathname()
    const isWorkflowPage = pathname?.includes('/w/') ?? false
    // Ready-by-default preserves the exact pre-desktop/web render path. A
    // claimed native listener flips this false in the gate's layout effect,
    // still before the browser can paint the opening surface.
    const [nativeSurfaceReady, setNativeSurfaceReady] = React.useState(true)
    const nativeSurfaceBarrierClaimedRef = React.useRef(false)
    const contentRef = React.useRef<React.ElementRef<typeof DialogPrimitive.Content> | null>(null)
    const deferredFocusDoneRef = React.useRef(false)
    const handleNativeSurfaceReadyChange = React.useCallback(
      (ready: boolean) => setNativeSurfaceReady(ready),
      []
    )
    const setContentRef = React.useCallback(
      (node: React.ElementRef<typeof DialogPrimitive.Content> | null) => {
        contentRef.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      },
      [ref]
    )
    const focusModalContent = React.useCallback(() => {
      const content = contentRef.current
      if (!content) return
      if (focusFirstTextInputIn(content)) return
      const firstControl = content.querySelector<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      ;(firstControl ?? content).focus()
    }, [])

    React.useLayoutEffect(() => {
      // With no claimed listener (the web app and older desktop shells), let
      // Radix run the original autofocus event untouched. Deferred focus is
      // exclusively part of the installed-shell atomic barrier.
      if (!nativeSurfaceBarrierClaimedRef.current) return
      if (!nativeSurfaceReady) {
        deferredFocusDoneRef.current = false
        return
      }
      if (deferredFocusDoneRef.current) return
      deferredFocusDoneRef.current = true
      if (!onOpenAutoFocus) {
        focusModalContent()
        return
      }
      const content = contentRef.current
      if (!content) return
      const event = new Event('openAutoFocus', { cancelable: true })
      Object.defineProperty(event, 'currentTarget', { value: content })
      onOpenAutoFocus(event)
      if (!event.defaultPrevented && !content.contains(document.activeElement)) {
        focusModalContent()
      }
    }, [focusModalContent, nativeSurfaceReady, onOpenAutoFocus])

    return (
      <ModalPortal>
        <ModalOverlay
          nativeSurfaceBarrierClaimedRef={nativeSurfaceBarrierClaimedRef}
          nativeSurfaceReady={nativeSurfaceReady}
          onNativeSurfaceReadyChange={handleNativeSurfaceReadyChange}
        />
        <div
          className={cn(
            'fixed inset-0 z-[var(--z-modal)] flex items-center justify-center',
            nativeSurfaceReady ? 'pointer-events-none' : 'pointer-events-auto'
          )}
          data-native-surface-modal-content-layer=''
          style={{
            ...(size === 'full'
              ? {}
              : {
                  paddingLeft: isWorkflowPage
                    ? 'calc(var(--sidebar-width) - var(--panel-width))'
                    : 'var(--sidebar-width)',
                }),
          }}
        >
          <DialogPrimitive.Content
            ref={setContentRef}
            className={cn(
              'pointer-events-auto flex max-h-[84vh] flex-col text-small',
              !bare &&
                'overflow-hidden rounded-xl bg-[var(--bg)] ring-[length:var(--border-width)] ring-foreground/10',
              ANIMATION_CLASSES,
              'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 duration-200',
              !nativeSurfaceReady && 'data-[state=open]:[animation-play-state:paused]',
              MODAL_SIZES[size],
              className
            )}
            style={{
              ...style,
              visibility: nativeSurfaceReady ? style?.visibility : 'hidden',
            }}
            onEscapeKeyDown={(e) => {
              // Radix reads `defaultPrevented`; stopPropagation alone would not block it.
              if (dismissDisabled) e.preventDefault()
              e.stopPropagation()
              onEscapeKeyDown?.(e)
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
              if (dismissDisabled || hasOpenFloatingLayer()) {
                e.preventDefault()
              }
              onInteractOutside?.(e)
            }}
            onOpenAutoFocus={(event) => {
              // Radix fires this once when the (still invisible) Content
              // mounts. Defer the consumer/default policy until the native
              // surface barrier releases, then run it exactly once above.
              if (nativeSurfaceBarrierClaimedRef.current && !nativeSurfaceReady) {
                event.preventDefault()
              } else (onOpenAutoFocus ?? focusFirstTextInput)(event)
            }}
            aria-describedby={ariaDescribedBy}
            {...props}
            data-native-surface-occlusion='modal'
          >
            <ModalBodyLockReleaser />
            {srTitle ? (
              <DialogPrimitive.Title className='sr-only'>{srTitle}</DialogPrimitive.Title>
            ) : null}
            <InsideModalContext.Provider value={true}>
              <ModalDismissDisabledContext.Provider value={dismissDisabled}>
                {children}
              </ModalDismissDisabledContext.Provider>
            </InsideModalContext.Provider>
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
  ({ className, children, ...props }, ref) => {
    const dismissDisabled = useModalDismissDisabled()
    return (
      <div
        ref={ref}
        className={cn('flex min-w-0 items-center justify-between gap-2 px-4 pt-4 pb-2', className)}
        {...props}
      >
        <DialogPrimitive.Title className='min-w-0 text-[var(--text-primary)] text-base leading-none'>
          {children}
        </DialogPrimitive.Title>
        <DialogPrimitive.Close asChild>
          <Button
            variant='ghost'
            disabled={dismissDisabled}
            className='relative size-[16px] shrink-0 p-0 before:absolute before:inset-[-14px] before:content-[""]'
          >
            <X className='size-[16px]' />
            <span className='sr-only'>Close</span>
          </Button>
        </DialogPrimitive.Close>
      </div>
    )
  }
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
      'px-1 pb-2 text-[var(--text-secondary)] text-small transition-colors',
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
