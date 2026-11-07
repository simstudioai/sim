'use client'

import { useCallback, useRef, useState } from 'react'

/** Keep a floating control inside its active theme and the nearest native dialog's top layer. */
export function usePopoverContainer() {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const opener = useRef<HTMLElement>(null)
  const trigger = useCallback((node: HTMLElement | null) => {
    opener.current = node
    setContainer(node?.closest<HTMLElement>('dialog, [data-emcn]') ?? null)
  }, [])
  return { trigger, container, opener }
}
