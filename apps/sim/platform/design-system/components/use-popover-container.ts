'use client'

import { useCallback, useState } from 'react'

/** Keep a floating control inside its active theme and the nearest native dialog's top layer. */
export function usePopoverContainer() {
  const [container, setContainer] = useState<Element | null>(null)
  const trigger = useCallback((node: HTMLButtonElement | null) => {
    setContainer(node?.closest('dialog, [data-platform-ui]') ?? null)
  }, [])
  return { trigger, container }
}
