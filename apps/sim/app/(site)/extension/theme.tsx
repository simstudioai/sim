'use client'

import { useEffect } from 'react'
import type { AppToExtensionMessage } from '@sim/browser-extension-protocol'
import { useTheme } from 'next-themes'

interface ExtensionThemeProps {
  origins: string[]
}

export function ExtensionTheme({ origins }: ExtensionThemeProps) {
  const { resolvedTheme } = useTheme()
  useEffect(() => {
    if (window.parent === window || (resolvedTheme !== 'light' && resolvedTheme !== 'dark')) return
    const message: AppToExtensionMessage = {
      channel: 'sim-extension',
      version: 1,
      type: 'theme',
      theme: resolvedTheme,
    }
    for (const origin of origins) window.parent.postMessage(message, origin)
  }, [origins, resolvedTheme])
  return null
}
