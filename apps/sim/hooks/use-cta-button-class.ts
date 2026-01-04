'use client'

import { useEffect, useState } from 'react'

const DEFAULT_BRAND_ACCENT = '#6f3dfa'

export type CtaButtonClass = 'cta-button-gradient' | 'cta-button-custom'

/**
 * Hook to determine the appropriate button class based on brand customization.
 * Returns 'cta-button-gradient' for default Sim branding, 'cta-button-custom' for whitelabeled instances.
 */
export function useCtaButtonClass(): CtaButtonClass {
  const [buttonClass, setButtonClass] = useState<CtaButtonClass>('cta-button-gradient')

  useEffect(() => {
    const checkCustomBrand = () => {
      const computedStyle = getComputedStyle(document.documentElement)
      const brandAccent = computedStyle.getPropertyValue('--brand-accent-hex').trim()

      if (brandAccent && brandAccent !== DEFAULT_BRAND_ACCENT) {
        setButtonClass('cta-button-custom')
      } else {
        setButtonClass('cta-button-gradient')
      }
    }

    checkCustomBrand()

    window.addEventListener('resize', checkCustomBrand)
    const observer = new MutationObserver(checkCustomBrand)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    })

    return () => {
      window.removeEventListener('resize', checkCustomBrand)
      observer.disconnect()
    }
  }, [])

  return buttonClass
}
