'use client'

import { useEffect, useRef, useState } from 'react'
import { cn, getAssetUrl } from '@/lib/utils'

interface VideoPlaceholderProps {
  /** Large title shown on the hero. */
  title?: string
  /** Small italic eyebrow above the title, e.g. a module name. */
  eyebrow?: string
  /** Pill in the top-right corner. Defaults to "Coming soon" (shown only until a video is set). */
  label?: string
  /**
   * Self-hosted video source. Accepts an absolute URL, a root-relative path
   * (`/static/...`), or a bare asset name resolved through the Blob CDN. When
   * set, the play button loads the video; otherwise the card is "coming soon".
   */
  src?: string
  className?: string
}

/** Resolve a video source: pass absolute/root-relative through, send bare names to the Blob CDN. */
function resolveVideoSrc(src: string): string {
  if (/^https?:\/\//.test(src) || src.startsWith('/')) return src
  return getAssetUrl(src)
}

/** The sim logotype, drawn with currentColor so the theme can tint it. */
function SimWordmark({ className }: { className?: string }) {
  return (
    <svg viewBox='0 0 816 392' fill='currentColor' aria-label='Sim' className={className}>
      <path d='M 0 297.507 L 54.609 297.507 C 54.609 312.642 60.07 324.71 70.992 333.709 C 81.914 342.299 96.679 346.594 115.287 346.594 C 135.512 346.594 151.086 342.707 162.008 334.936 C 172.93 326.754 178.391 315.915 178.391 302.415 C 178.391 292.598 175.357 284.417 169.289 277.871 C 163.627 271.326 153.109 266.009 137.737 261.918 L 85.555 249.646 C 59.261 243.102 39.642 233.08 26.698 219.581 C 14.158 206.082 7.888 188.287 7.888 166.198 C 7.888 147.79 12.54 131.837 21.844 118.338 C 31.552 104.838 44.699 94.408 61.284 87.045 C 78.274 79.682 97.69 76 119.534 76 C 141.378 76 160.187 79.886 175.964 87.658 C 192.144 95.43 204.684 106.271 213.584 120.179 C 222.888 134.086 227.742 150.654 228.146 169.88 L 173.536 169.88 C 173.132 154.335 168.076 142.267 158.368 133.678 C 148.659 125.087 135.108 120.792 117.714 120.792 C 99.915 120.792 86.162 124.678 76.453 132.451 C 66.745 140.223 61.891 150.858 61.891 164.357 C 61.891 184.402 76.453 198.105 105.579 205.468 L 157.76 218.354 C 182.841 224.08 201.651 233.489 214.191 246.579 C 226.73 259.26 233 276.644 233 298.734 C 233 317.55 227.943 334.118 217.831 348.435 C 207.718 362.343 193.762 373.183 175.964 380.955 C 158.57 388.318 137.939 392 114.073 392 C 79.285 392 51.576 383.409 30.945 366.229 C 10.315 349.048 0 326.141 0 297.507 Z' />
      <path d='M 430.759 392 L 374 392 L 374 92 L 424.721 92 L 424.721 143.095 C 430.76 126.357 442.433 112.167 458.535 101.145 C 475.039 89.715 494.966 84 518.314 84 C 544.48 84 566.217 91.144 583.527 105.431 C 600.837 119.719 612.108 138.701 617.342 162.378 L 607.076 162.378 C 611.102 138.701 622.172 119.719 640.287 105.431 C 658.401 91.144 680.743 84 707.311 84 C 741.126 84 767.694 94.001 787.017 114.004 C 806.339 134.006 816 161.357 816 196.056 L 816 392 L 760.448 392 L 760.448 210.139 C 760.448 186.462 754.41 168.297 742.333 155.643 C 730.66 142.579 714.758 136.048 694.631 136.048 C 680.542 136.048 668.062 139.314 657.194 145.845 C 646.728 151.968 638.475 160.949 632.437 172.787 C 626.398 184.625 623.38 198.505 623.38 214.425 L 623.38 392 L 567.223 392 L 567.223 209.527 C 567.223 185.85 561.387 167.888 549.713 155.643 C 538.039 142.988 522.138 136.66 502.01 136.66 C 487.921 136.66 475.442 139.926 464.574 146.457 C 454.108 152.58 445.855 161.562 439.817 173.4 C 433.778 184.83 430.759 198.505 430.759 214.425 L 430.759 392 Z' />
      <path d='M 342 38 C 342 58.987 324.987 76 304 76 C 283.013 76 266 58.987 266 38 C 266 17.013 283.013 0 304 0 C 324.987 0 342 17.013 342 38 Z' />
      <path d='M 332 392 L 276 392 L 276 92 C 284.5 95.988 293.99 98.218 304 98.218 C 314.01 98.218 323.5 95.988 332 92 L 332 392 Z' />
    </svg>
  )
}

/**
 * A 16:9 lesson hero used across the Academy. Always shows the design-system
 * video card (title, blueprint grid, theme-aware dark/light). When a `src` is
 * provided the play button loads the self-hosted video inline; otherwise the
 * card reads "Coming soon" and the play button is muted.
 */
export function VideoPlaceholder({
  title,
  eyebrow,
  label = 'Coming soon',
  src,
  className,
}: VideoPlaceholderProps) {
  const hasVideo = Boolean(src)
  const [playing, setPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const pendingSeek = useRef<number | null>(null)

  // Chapter rows (VideoChapters) dispatch `academy:seek` with a time in seconds.
  // Start the video if it isn't playing yet, then jump there.
  useEffect(() => {
    if (!src) return
    const onSeek = (e: Event) => {
      const time = (e as CustomEvent<{ time: number }>).detail?.time
      if (typeof time !== 'number') return
      const video = videoRef.current
      if (video) {
        video.currentTime = time
        void video.play()
      } else {
        pendingSeek.current = time
        setPlaying(true)
      }
    }
    window.addEventListener('academy:seek', onSeek)
    return () => window.removeEventListener('academy:seek', onSeek)
  }, [src])

  if (playing && src) {
    return (
      <div
        className={cn(
          'not-prose my-6 aspect-video w-full overflow-hidden rounded-[20px] bg-black',
          className
        )}
      >
        {/* biome-ignore lint/a11y/useMediaCaption: lesson videos have no caption track yet */}
        <video
          ref={videoRef}
          src={resolveVideoSrc(src)}
          title={title ?? 'Lesson video'}
          controls
          autoPlay
          playsInline
          onLoadedMetadata={() => {
            if (pendingSeek.current != null && videoRef.current) {
              videoRef.current.currentTime = pendingSeek.current
              void videoRef.current.play()
              pendingSeek.current = null
            }
          }}
          className='h-full w-full border-0'
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'not-prose group relative my-6 aspect-video w-full select-none overflow-hidden rounded-[20px] font-season transition-transform duration-200 [container-type:inline-size]',
        'shadow-[inset_0_0_0_1px_#E6E6E6] [background:radial-gradient(130%_130%_at_50%_14%,#ffffff_0%,#f6f6f6_55%,#ececec_100%)]',
        'dark:shadow-none dark:[background:radial-gradient(130%_130%_at_50%_18%,#1c1c1c_0%,#121212_45%,#0a0a0a_100%)]',
        className
      )}
    >
      {/* Blueprint grid — faint, fading to atmosphere at the edges */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(18,18,18,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(18,18,18,0.05)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(120%_90%_at_50%_35%,#000_30%,transparent_100%)] dark:[background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)]'
      />

      {/* Corner plus-marks, 20px inset */}
      {['top-5 left-5', 'top-5 right-5', 'bottom-5 left-5', 'right-5 bottom-5'].map((pos) => (
        <span
          key={pos}
          aria-hidden
          className={cn(
            'absolute font-mono text-[20px] text-[rgba(18,18,18,0.22)] leading-none dark:text-[rgba(255,255,255,0.28)]',
            pos
          )}
        >
          +
        </span>
      ))}

      {/* Top-right status pill — only until a video is wired up */}
      {!hasVideo && (
        <span className='absolute top-6 right-6 z-10 inline-flex items-center gap-2 rounded-full border border-[#E6E6E6] bg-white px-4 py-2 font-medium text-[#5F5F5F] text-[12px] uppercase tracking-[0.14em] md:top-8 md:right-8 dark:border-white/12 dark:bg-[#1A1A1A] dark:text-[#E6E6E6]'>
          <span className='size-1.5 rounded-full bg-[#1F8A5B]' />
          {label}
        </span>
      )}

      {/* Heading: eyebrow + title, bottom-left (design: left:40 bottom:40) */}
      <div className='absolute bottom-10 left-10 z-10 max-w-[80%]'>
        {eyebrow && (
          <span className='mb-[14px] block font-normal text-[#5F5F5F] text-[clamp(15px,2cqi,22px)] italic tracking-[-0.01em] dark:text-[#B4B4B4]'>
            {eyebrow}
          </span>
        )}
        {title && (
          <span className='block font-semibold text-[#121212] text-[clamp(2.5rem,9.5cqi,5.5rem)] leading-[0.96] tracking-[-0.035em] dark:text-[#F8F8F8]'>
            {title}
          </span>
        )}
      </div>

      {/* Wordmark, bottom-right (design: right:40 bottom:40, svg height 22) */}
      <span className='absolute right-10 bottom-10 z-10 text-[#121212] dark:text-white/90'>
        <SimWordmark className='block h-[22px] w-auto' />
      </span>

      {/* Centered play button — active when a video is wired, muted otherwise */}
      <div className='absolute inset-0 z-10 grid place-items-center'>
        {hasVideo ? (
          <button
            type='button'
            onClick={() => setPlaying(true)}
            aria-label={title ? `Play ${title}` : 'Play video'}
            className='grid h-12 w-16 cursor-pointer place-items-center rounded-[14px] bg-[rgba(255,255,255,0.78)] shadow-[0_1px_3px_rgba(18,18,18,0.12),inset_0_0_0_1px_#E6E6E6] backdrop-blur-[4px] transition-transform duration-200 hover:scale-105 active:scale-95 dark:bg-[rgba(10,10,10,0.72)] dark:shadow-none'
          >
            <svg
              width='18'
              height='20'
              viewBox='0 0 18 20'
              aria-hidden
              className='translate-x-[1px] text-[#121212] dark:text-white'
            >
              <path d='M0 0l18 10L0 20z' fill='currentColor' />
            </svg>
          </button>
        ) : (
          <span className='grid h-12 w-16 place-items-center rounded-[14px] bg-[rgba(255,255,255,0.78)] opacity-60 shadow-[0_1px_3px_rgba(18,18,18,0.12),inset_0_0_0_1px_#E6E6E6] backdrop-blur-[4px] dark:bg-[rgba(10,10,10,0.72)] dark:shadow-none'>
            <svg
              width='18'
              height='20'
              viewBox='0 0 18 20'
              aria-hidden
              className='translate-x-[1px] text-[#121212] dark:text-white'
            >
              <path d='M0 0l18 10L0 20z' fill='currentColor' />
            </svg>
          </span>
        )}
      </div>
    </div>
  )
}
