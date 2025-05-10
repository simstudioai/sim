'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { useTheme } from 'next-themes'

interface ThemeImageProps {
  lightSrc: string
  darkSrc: string
  alt: string
  width?: number
  height?: number
  className?: string
}

export function ThemeImage({
  lightSrc,
  darkSrc,
  alt,
  width = 600,
  height = 400,
  className = 'rounded-lg border border-border my-6',
}: ThemeImageProps) {
  const { resolvedTheme } = useTheme()
  const [imageSrc, setImageSrc] = useState(lightSrc)
  const [mounted, setMounted] = useState(false)

  // Wait until component is mounted to avoid hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (mounted) {
      setImageSrc(resolvedTheme === 'dark' ? darkSrc : lightSrc)
    }
  }, [resolvedTheme, lightSrc, darkSrc, mounted])

  if (!mounted) {
    return null
  }

  return (
    <div className="flex justify-center">
      <Image src={imageSrc} alt={alt} width={width} height={height} className={className} />
    </div>
  )
}
