import { type MutableRefObject, useEffect, useRef } from 'react'

/**
 * A hook that handles forwarded refs and returns a mutable ref object
 * Useful for components that need both a forwarded ref and a local ref
 * @param forwardedRef The forwarded ref from React.forwardRef
 * @returns A mutable ref object that can be used locally
 */
export function useForwardedRef<T>(
  forwardedRef: React.ForwardedRef<T>
): MutableRefObject<T | null> {
  const innerRef = useRef<T | null>(null)

  useEffect(() => {
    if (!forwardedRef) return

    if (typeof forwardedRef === 'function') {
      forwardedRef(innerRef.current)
    } else {
      forwardedRef.current = innerRef.current
    }
  }, [forwardedRef])

  return innerRef
}
