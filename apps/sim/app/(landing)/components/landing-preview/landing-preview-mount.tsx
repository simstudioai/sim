'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import type { SidebarView } from '@/app/(landing)/components/landing-preview/components/landing-preview-sidebar/landing-preview-sidebar'

/** Dimension-stable placeholder sized to the preview's exact footprint (zero CLS). */
const PLACEHOLDER_CLASS = 'aspect-[1116/615] w-full rounded bg-[var(--surface-1)]'

/**
 * Load the preview chunk a little before it scrolls into view so it's ready by
 * the time the user reaches it, without paying for it on initial load.
 */
const PRELOAD_ROOT_MARGIN = '400px'

/**
 * Client mount for the {@link LandingPreview} - the heavy, animated workspace
 * island (framer-motion + reactflow). Isolated here so the sections that show it
 * stay Server Components: only this leaf is `'use client'`.
 *
 * Loaded with `ssr: false` so the framer-motion/reactflow bundle never ships in
 * the server-rendered HTML, and **gated on viewport proximity**: the chunk only
 * downloads once an {@link IntersectionObserver} reports the mount is near the
 * viewport, so the below-the-fold previews don't pull the heavy bundle into the
 * initial homepage load. A dimension-stable placeholder (the preview's exact
 * `aspect-[1116/615]` footprint, filled with the canvas surface) holds the space
 * before and during load, so there is zero layout shift or flash.
 */
const LandingPreview = dynamic(
  () =>
    import('@/app/(landing)/components/landing-preview/landing-preview').then(
      (mod) => mod.LandingPreview
    ),
  {
    ssr: false,
    loading: () => <div className={PLACEHOLDER_CLASS} />,
  }
)

interface LandingPreviewMountProps {
  /** Forwarded to {@link LandingPreview}; `false` renders a static snapshot. */
  autoplay?: boolean
  /** Forwarded to {@link LandingPreview}; the static snapshot's staged view. */
  view?: SidebarView
  /** Forwarded to {@link LandingPreview}; the static snapshot's workflow. */
  workflowId?: string
}

export function LandingPreviewMount({ autoplay, view, workflowId }: LandingPreviewMountProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (inView) return
    // Graceful degradation: without IntersectionObserver support, load eagerly
    // rather than leave the preview stuck on its placeholder.
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setInView(true)
      },
      { rootMargin: PRELOAD_ROOT_MARGIN }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [inView])

  return (
    <div ref={ref}>
      {inView ? (
        <LandingPreview autoplay={autoplay} view={view} workflowId={workflowId} />
      ) : (
        <div className={PLACEHOLDER_CLASS} />
      )}
    </div>
  )
}
