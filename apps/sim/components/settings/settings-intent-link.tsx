'use client'

import { type ComponentProps, useRef, useState } from 'react'
import Link from 'next/link'

interface SettingsIntentLinkProps extends Omit<ComponentProps<typeof Link>, 'prefetch'> {
  /** Runs once when pointer, keyboard, or touch interaction signals likely navigation. */
  onIntent?: () => void
}

/**
 * A settings navigation link that avoids eager route work until interaction
 * lets Next.js apply its normal destination-aware prefetch behavior.
 */
export function SettingsIntentLink({
  onIntent,
  onPointerEnter,
  onFocus,
  onTouchStart,
  ...props
}: SettingsIntentLinkProps) {
  const intentHandledRef = useRef(false)
  const [hasIntent, setHasIntent] = useState(false)

  const handleIntent = () => {
    if (intentHandledRef.current) return
    intentHandledRef.current = true
    setHasIntent(true)
    onIntent?.()
  }

  return (
    <Link
      {...props}
      prefetch={hasIntent ? null : false}
      onPointerEnter={(event) => {
        onPointerEnter?.(event)
        if (!event.defaultPrevented) handleIntent()
      }}
      onFocus={(event) => {
        onFocus?.(event)
        if (!event.defaultPrevented) handleIntent()
      }}
      onTouchStart={(event) => {
        onTouchStart?.(event)
        if (!event.defaultPrevented) handleIntent()
      }}
    />
  )
}
