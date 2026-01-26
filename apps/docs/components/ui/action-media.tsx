'use client'

import { getAssetUrl } from '@/lib/utils'

interface ActionImageProps {
  src: string
  alt: string
}

interface ActionVideoProps {
  src: string
  alt: string
}

export function ActionImage({ src, alt }: ActionImageProps) {
  const resolvedSrc = getAssetUrl(src.startsWith('/') ? src.slice(1) : src)

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className='inline-block w-full max-w-[200px] rounded border border-neutral-200 dark:border-neutral-700'
    />
  )
}

export function ActionVideo({ src, alt }: ActionVideoProps) {
  const resolvedSrc = getAssetUrl(src.startsWith('/') ? src.slice(1) : src)

  return (
    <video
      src={resolvedSrc}
      autoPlay
      loop
      muted
      playsInline
      className='inline-block w-full max-w-[200px] rounded border border-neutral-200 dark:border-neutral-700'
    />
  )
}
