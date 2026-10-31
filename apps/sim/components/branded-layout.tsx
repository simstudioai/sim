'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { isAuthSurfacePath } from '@/lib/navigation/auth-surfaces'
import { getBrandConfig } from '@/ee/whitelabeling'

interface BrandedLayoutProps {
  children: React.ReactNode
}

export function BrandedLayout({ children }: BrandedLayoutProps) {
  const pathname = usePathname()
  const authSurface = isAuthSurfacePath(pathname)

  useEffect(() => {
    const config = getBrandConfig()

    if (config.name !== 'Sim') {
      document.title = config.name
    }

    if (config.faviconUrl) {
      const faviconLink = document.querySelector("link[rel*='icon']") as HTMLLinkElement
      if (faviconLink) {
        faviconLink.href = config.faviconUrl
      }
    }
  }, [])

  useEffect(() => {
    const config = getBrandConfig()
    // Public resource routes can move between an Auth gate and their branded viewer.
    const resourceRoute = pathname.startsWith('/f/') || pathname.startsWith('/chat/')
    const syncCustomCss = () => {
      const customCssId = 'custom-brand-css'
      let customCssLink = document.getElementById(customCssId) as HTMLLinkElement
      const authVisible = resourceRoute
        ? Boolean(document.querySelector('[data-auth-root]'))
        : authSurface
      if (authVisible) {
        customCssLink?.remove()
      } else if (config.customCssUrl && !customCssLink) {
        customCssLink = document.createElement('link')
        customCssLink.id = customCssId
        customCssLink.rel = 'stylesheet'
        customCssLink.href = config.customCssUrl
        document.head.appendChild(customCssLink)
      }
    }
    syncCustomCss()
    if (!resourceRoute) return
    const observer = new MutationObserver(syncCustomCss)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [authSurface, pathname])

  return <>{children}</>
}
