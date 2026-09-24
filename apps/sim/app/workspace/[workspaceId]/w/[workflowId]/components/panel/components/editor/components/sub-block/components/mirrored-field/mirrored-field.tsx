import {
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { cn, Input, Textarea } from '@sim/emcn'

interface MirrorProps {
  overlay: ReactNode
  overlayClassName: string
  overlayStyle?: CSSProperties
  overlayRef?: Ref<HTMLDivElement>
}

type MirroredInputProps = InputHTMLAttributes<HTMLInputElement> & MirrorProps
type MirroredTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & MirrorProps

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value)
  else if (ref) ref.current = value
}

/** Keeps a formatted text mirror aligned with the native editing control. */
function useMirror<T extends HTMLInputElement | HTMLTextAreaElement>(
  forwardedRef: Ref<T> | undefined,
  overlayRef: Ref<HTMLDivElement> | undefined,
  value: string | number | readonly string[] | undefined
) {
  const control = useRef<T | null>(null)
  const mirror = useRef<HTMLDivElement | null>(null)
  const animationFrame = useRef<number | null>(null)
  const [isComposing, setIsComposing] = useState(false)

  const syncScroll = useCallback(() => {
    if (!control.current || !mirror.current) return
    mirror.current.scrollLeft = control.current.scrollLeft
    mirror.current.scrollTop = control.current.scrollTop
  }, [])

  const scheduleSync = useCallback(() => {
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current)
    animationFrame.current = requestAnimationFrame(() => {
      animationFrame.current = null
      syncScroll()
    })
  }, [syncScroll])

  useEffect(() => {
    syncScroll()
  }, [syncScroll, value, isComposing])

  useEffect(
    () => () => {
      if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current)
    },
    []
  )

  const setControlRef = useCallback(
    (node: T | null) => {
      control.current = node
      assignRef(forwardedRef, node)
    },
    [forwardedRef]
  )

  const setOverlayRef = useCallback(
    (node: HTMLDivElement | null) => {
      mirror.current = node
      assignRef(overlayRef, node)
      syncScroll()
    },
    [overlayRef, syncScroll]
  )

  return { isComposing, setIsComposing, scheduleSync, setControlRef, setOverlayRef, syncScroll }
}

/** Native single-line editor with an accessible, synchronized formatted-text mirror. */
export function MirroredInput({
  overlay,
  overlayClassName,
  overlayStyle,
  overlayRef,
  className,
  onScroll,
  onInput,
  onPaste,
  onCompositionStart,
  onCompositionEnd,
  style,
  value,
  ref,
  ...props
}: MirroredInputProps & { ref?: Ref<HTMLInputElement> }) {
  const mirror = useMirror(ref, overlayRef, value)

  return (
    <>
      <Input
        {...props}
        ref={mirror.setControlRef}
        value={value}
        className={cn(
          'text-transparent caret-foreground transition-[background-color,border-color,text-decoration-color]',
          className
        )}
        style={{ ...style, ...(mirror.isComposing && { color: 'var(--text-primary)' }) }}
        onScroll={(event) => {
          mirror.syncScroll()
          onScroll?.(event)
        }}
        onInput={(event) => {
          onInput?.(event)
          mirror.scheduleSync()
        }}
        onPaste={(event) => {
          onPaste?.(event)
          mirror.scheduleSync()
        }}
        onCompositionStart={(event) => {
          mirror.setIsComposing(true)
          onCompositionStart?.(event)
        }}
        onCompositionEnd={(event) => {
          onCompositionEnd?.(event)
          mirror.setIsComposing(false)
          mirror.scheduleSync()
        }}
      />
      <div
        ref={mirror.setOverlayRef}
        aria-hidden='true'
        className={overlayClassName}
        style={{ ...overlayStyle, ...(mirror.isComposing && { visibility: 'hidden' }) }}
      >
        {overlay}
      </div>
    </>
  )
}

/** Native multiline editor with the same scroll and composition behavior. */
export function MirroredTextarea({
  overlay,
  overlayClassName,
  overlayStyle,
  overlayRef,
  className,
  onScroll,
  onInput,
  onPaste,
  onCompositionStart,
  onCompositionEnd,
  style,
  value,
  ref,
  ...props
}: MirroredTextareaProps & { ref?: Ref<HTMLTextAreaElement> }) {
  const mirror = useMirror(ref, overlayRef, value)

  return (
    <>
      <Textarea
        {...props}
        ref={mirror.setControlRef}
        value={value}
        className={cn(
          'text-transparent caret-foreground transition-[background-color,border-color,text-decoration-color]',
          className
        )}
        style={{ ...style, ...(mirror.isComposing && { color: 'var(--text-primary)' }) }}
        onScroll={(event) => {
          mirror.syncScroll()
          onScroll?.(event)
        }}
        onInput={(event) => {
          onInput?.(event)
          mirror.scheduleSync()
        }}
        onPaste={(event) => {
          onPaste?.(event)
          mirror.scheduleSync()
        }}
        onCompositionStart={(event) => {
          mirror.setIsComposing(true)
          onCompositionStart?.(event)
        }}
        onCompositionEnd={(event) => {
          onCompositionEnd?.(event)
          mirror.setIsComposing(false)
          mirror.scheduleSync()
        }}
      />
      <div
        ref={mirror.setOverlayRef}
        aria-hidden='true'
        className={overlayClassName}
        style={{ ...overlayStyle, ...(mirror.isComposing && { visibility: 'hidden' }) }}
      >
        {overlay}
      </div>
    </>
  )
}
