'use client'

import dynamic from 'next/dynamic'
import type { SidebarView } from '@/app/(landing)/components/landing-preview/components/landing-preview-sidebar/landing-preview-sidebar'

/**
 * Client mount for the {@link LandingPreview} - the heavy, animated workspace
 * island (framer-motion + reactflow). Isolated here so the sections that show it
 * stay Server Components: only this leaf is `'use client'`.
 *
 * Loaded with `ssr: false` so the framer-motion/reactflow bundle never ships in
 * the server-rendered HTML, and behind a dimension-stable placeholder sized to
 * the preview's exact `aspect-[1116/615]` footprint so there is zero layout
 * shift while it streams in. The placeholder fills with the canvas surface
 * (`--surface-1`) so there is no flash as the island mounts.
 */
const LandingPreview = dynamic(
  () =>
    import('@/app/(landing)/components/landing-preview/landing-preview').then(
      (mod) => mod.LandingPreview
    ),
  {
    ssr: false,
    loading: () => <div className='aspect-[1116/615] w-full rounded bg-[var(--surface-1)]' />,
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
  return <LandingPreview autoplay={autoplay} view={view} workflowId={workflowId} />
}
