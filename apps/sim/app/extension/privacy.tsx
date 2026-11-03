'use client'

import { useLayoutEffect } from 'react'

/** Blocks the entire extension document, including body portals, from session replay. */
export function ExtensionPrivacy() {
  useLayoutEffect(() => {
    const body = document.body
    const alreadyBlocked = body.classList.contains('ph-no-capture')
    body.classList.add('ph-no-capture')
    return () => {
      if (!alreadyBlocked) body.classList.remove('ph-no-capture')
    }
  }, [])
  return null
}
