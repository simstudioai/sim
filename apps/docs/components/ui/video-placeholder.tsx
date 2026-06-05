'use client'

import { Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Video } from './video'

interface VideoPlaceholderProps {
  /** Large title shown on the hero. */
  title?: string
  /** Small italic eyebrow above the title, e.g. a module name. */
  eyebrow?: string
  /** Pill in the top-right corner. Defaults to "Coming soon". */
  label?: string
  /**
   * When set, the real {@link Video} player renders instead of the placeholder,
   * so a script page becomes a video page by adding one prop.
   */
  src?: string
  className?: string
}

/**
 * A dark, 16:9 lesson video hero used across the Academy. Shows the lesson title
 * and a play affordance over a faint blueprint grid. Renders the real player as
 * soon as a `src` is provided.
 */
export function VideoPlaceholder({
  title,
  eyebrow,
  label = 'Coming soon',
  src,
  className,
}: VideoPlaceholderProps) {
  if (src) return <Video src={src} />

  return (
    <div
      className={cn(
        'group relative my-6 flex aspect-video w-full select-none overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 text-white',
        className
      )}
    >
      {/* Blueprint grid */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 opacity-[0.4] [background-image:linear-gradient(to_right,rgba(255,255,255,0.07)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:46px_46px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_80%)]'
      />
      {/* Corner plus-marks */}
      <span aria-hidden className='absolute top-4 left-4 text-white/25 text-sm'>
        +
      </span>
      <span aria-hidden className='absolute top-4 right-4 text-white/25 text-sm'>
        +
      </span>
      <span aria-hidden className='absolute bottom-4 left-4 text-white/25 text-sm'>
        +
      </span>
      <span aria-hidden className='absolute right-4 bottom-4 text-white/25 text-sm'>
        +
      </span>

      {/* Top-right status pill */}
      <span className='absolute top-4 right-7 z-10 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 font-medium text-[10px] text-white/70 uppercase tracking-[0.08em] backdrop-blur-sm'>
        <span className='size-1.5 rounded-full bg-[#33c482]' />
        {label}
      </span>

      {/* Title block, lower-left */}
      <div className='absolute bottom-7 left-7 z-10 max-w-[70%]'>
        {eyebrow && <p className='mb-1 font-light text-white/55 text-base italic'>{eyebrow}</p>}
        {title && (
          <p className='font-semibold text-[clamp(1.4rem,3.4vw,2.6rem)] text-white leading-[1.05] tracking-tight'>
            {title}
          </p>
        )}
      </div>

      {/* Wordmark, bottom-right */}
      <span className='absolute right-7 bottom-7 z-10 font-medium text-sm text-white/40 lowercase tracking-tight'>
        sim
      </span>

      {/* Centered play button */}
      <div className='absolute inset-0 z-10 flex items-center justify-center'>
        <span className='flex h-12 w-[68px] items-center justify-center rounded-xl border border-white/15 bg-black/55 backdrop-blur-sm transition-all duration-200 group-hover:scale-105 group-hover:bg-black/70'>
          <Play
            className='size-6 translate-x-[1px] text-white'
            fill='currentColor'
            strokeWidth={0}
          />
        </span>
      </div>
    </div>
  )
}
