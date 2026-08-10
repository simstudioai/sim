import {
  type CSSProperties,
  forwardRef,
  type ReactNode,
  type Ref,
  type RefObject,
  type UIEvent,
  useRef,
} from 'react'
import { ChipInput, type ChipInputProps, ChipTextarea, type ChipTextareaProps, cn } from '@sim/emcn'

interface ReferenceOverlayProps {
  content: ReactNode
  disabled?: boolean
  interactive?: boolean
  multiline?: boolean
  className?: string
  overlayRef?: Ref<HTMLDivElement>
}

function ReferenceOverlay({
  content,
  disabled = false,
  interactive = false,
  multiline = false,
  className,
  overlayRef,
}: ReferenceOverlayProps) {
  return (
    <div
      ref={overlayRef}
      aria-hidden
      className={cn(
        'absolute inset-0 overflow-auto bg-transparent px-2 text-[var(--text-body)] text-sm [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        multiline
          ? 'box-border whitespace-pre-wrap break-words border border-transparent py-1.5'
          : 'flex items-center overflow-y-hidden',
        disabled && 'opacity-50',
        !interactive && 'pointer-events-none',
        className
      )}
    >
      {content}
    </div>
  )
}

interface ReferenceTextInputProps extends ChipInputProps {
  overlayContent: ReactNode
  overlayClassName?: string
  overlayRef?: Ref<HTMLDivElement>
  interactiveOverlay?: boolean
}

/**
 * Composes the canonical single-line chip field with workflow reference
 * decoration while preserving the native input as the accessible value owner.
 */
export const ReferenceTextInput = forwardRef<HTMLInputElement, ReferenceTextInputProps>(
  (
    {
      overlayContent,
      overlayClassName,
      overlayRef,
      interactiveOverlay = false,
      inputClassName,
      onScroll,
      disabled,
      ...props
    },
    ref
  ) => {
    const internalOverlayRef = useRef<HTMLDivElement>(null)
    const setOverlayRef = (node: HTMLDivElement | null) => {
      internalOverlayRef.current = node
      if (typeof overlayRef === 'function') overlayRef(node)
      else if (overlayRef) overlayRef.current = node
    }
    const handleScroll = (event: UIEvent<HTMLInputElement>) => {
      if (internalOverlayRef.current) {
        internalOverlayRef.current.scrollLeft = event.currentTarget.scrollLeft
      }
      onScroll?.(event)
    }

    return (
      <div className='relative w-full'>
        <ChipInput
          ref={ref}
          inputClassName={cn(
            'overflow-auto text-transparent caret-[var(--text-primary)] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            inputClassName
          )}
          onScroll={handleScroll}
          disabled={disabled}
          {...props}
        />
        <ReferenceOverlay
          content={overlayContent}
          disabled={disabled}
          interactive={interactiveOverlay}
          className={overlayClassName}
          overlayRef={setOverlayRef}
        />
      </div>
    )
  }
)

ReferenceTextInput.displayName = 'ReferenceTextInput'

interface ReferenceTextareaProps extends ChipTextareaProps {
  overlayContent: ReactNode
  overlayClassName?: string
  overlayRef?: Ref<HTMLDivElement>
  interactiveOverlay?: boolean
  containerClassName?: string
  containerStyle?: CSSProperties
  containerRef?: RefObject<HTMLDivElement | null>
  adornment?: ReactNode
}

/**
 * Multi-line counterpart of {@link ReferenceTextInput}; owns the decorated
 * overlay and scroll synchronization while callers own workflow behavior.
 */
export const ReferenceTextarea = forwardRef<HTMLTextAreaElement, ReferenceTextareaProps>(
  (
    {
      overlayContent,
      overlayClassName,
      overlayRef,
      interactiveOverlay = false,
      containerClassName,
      containerStyle,
      containerRef,
      adornment,
      className,
      onScroll,
      disabled,
      ...props
    },
    ref
  ) => {
    const internalOverlayRef = useRef<HTMLDivElement>(null)
    const setOverlayRef = (node: HTMLDivElement | null) => {
      internalOverlayRef.current = node
      if (typeof overlayRef === 'function') overlayRef(node)
      else if (overlayRef) overlayRef.current = node
    }
    const handleScroll = (event: UIEvent<HTMLTextAreaElement>) => {
      if (internalOverlayRef.current) {
        internalOverlayRef.current.scrollTop = event.currentTarget.scrollTop
        internalOverlayRef.current.scrollLeft = event.currentTarget.scrollLeft
      }
      onScroll?.(event)
    }

    return (
      <div
        ref={containerRef}
        className={cn('group relative w-full', containerClassName)}
        style={containerStyle}
      >
        <ChipTextarea
          ref={ref}
          className={cn(
            'h-full min-h-full text-transparent caret-[var(--text-primary)]',
            className
          )}
          onScroll={handleScroll}
          disabled={disabled}
          {...props}
        />
        <ReferenceOverlay
          content={overlayContent}
          disabled={disabled}
          interactive={interactiveOverlay}
          multiline
          className={cn('h-full w-full', overlayClassName)}
          overlayRef={setOverlayRef}
        />
        {adornment}
      </div>
    )
  }
)

ReferenceTextarea.displayName = 'ReferenceTextarea'
