import type { ReactNode } from 'react'
import Image from 'next/image'

interface PlatformHeroVisualProps {
  /** The live platform interior - a platform loop or editor loop island. */
  children: ReactNode
}

/**
 * The enterprise hero's visual composition, shared: the architectural backdrop
 * (`enterprise-hero-background.webp`) with the white demo window framed in
 * front of it, ready to hold a live platform interior (a chat platform loop or
 * the workflows editor loop). Extracted so every hero - the enterprise page
 * included - reuses the exact backdrop, window geometry (`aspect-[1080/620]`
 * at 83.08% width), and shadow treatment the enterprise page established.
 *
 * Renders inside a hero visual slot (the `variant='home'` media frame or the
 * standard {@link SolutionsVisualFrame}); the outer `relative` wrapper anchors
 * the `fill` image in frames that don't position themselves.
 */
export function PlatformHeroVisual({ children }: PlatformHeroVisualProps) {
  return (
    <div className='relative h-full w-full'>
      <Image
        fill
        priority
        fetchPriority='high'
        alt=''
        className='object-cover object-center'
        sizes='(max-width: 1024px) 100vw, 1300px'
        src='/landing/enterprise-hero-background.webp'
      />
      <div className='-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 flex aspect-[1080/620] w-[83.08%] flex-col overflow-hidden rounded-[10px] bg-[var(--surface-1)] shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_6px_0_rgba(0,0,0,0.05),0_4px_42px_0_rgba(0,0,0,0.06)]'>
        <div className='relative flex-1'>{children}</div>
      </div>
    </div>
  )
}
