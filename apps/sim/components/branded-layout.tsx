'use client'

import { useEffect } from 'react'
import { generateBrandCSS, getBrandConfig } from '@/lib/branding/branding'

interface BrandedLayoutProps {
  children: React.ReactNode
}

export function BrandedLayout({ children }: BrandedLayoutProps) {
  useEffect(() => {
    const config = getBrandConfig()

    // Update document title
    if (config.name !== 'Sim') {
      document.title = config.name
    }

    // Update favicon
    if (config.faviconUrl) {
      const faviconLink = document.querySelector("link[rel*='icon']") as HTMLLinkElement
      if (faviconLink) {
        faviconLink.href = config.faviconUrl
      }
    }

    // Inject brand CSS
    const brandStyleId = 'brand-styles'
    let brandStyleElement = document.getElementById(brandStyleId) as HTMLStyleElement

    if (!brandStyleElement) {
      brandStyleElement = document.createElement('style')
      brandStyleElement.id = brandStyleId
      document.head.appendChild(brandStyleElement)
    }

    brandStyleElement.textContent = generateBrandCSS(config)

    // Load custom CSS if provided
    if (config.customCssUrl) {
      const customCssId = 'custom-brand-css'
      let customCssLink = document.getElementById(customCssId) as HTMLLinkElement

      if (!customCssLink) {
        customCssLink = document.createElement('link')
        customCssLink.id = customCssId
        customCssLink.rel = 'stylesheet'
        customCssLink.href = config.customCssUrl
        document.head.appendChild(customCssLink)
      }
    }
  }, [])

  return <>{children}</>
}
