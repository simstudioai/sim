"use client"

// @ts-ignore
import { ReactLenis } from 'lenis/react'
// @ts-ignore
import type { LenisRef } from 'lenis/react'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { useRef } from 'react'

export const LenisWrapper = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname()
  const lenisRef = useRef<LenisRef>(null)
  
  useEffect(() => {
    lenisRef.current?.lenis?.scrollTo(0, { immediate: true })
  }, [pathname])

  return (
    <ReactLenis root ref={lenisRef} options={{
      lerp: 2,
      duration: 1.5,
      smoothWheel: true,
      wheelMultiplier: 1.2,
      touchMultiplier: 2,
      infinite: false,
      orientation: "vertical",
    }}>
      {children}
    </ReactLenis>
  )
} 