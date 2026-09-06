'use client'

import type { ComponentType } from 'react'
import dynamic from 'next/dynamic'
import { useLazyMount } from '@/app/(landing)/hooks/use-lazy-mount'

/**
 * The five Sim products with a live landing loop, keyed by product, plus the
 * platform suite's two scenes: `agents` (Sim's chat building a workflow on
 * the real stage) and `governance` (the organization's overview).
 */
export type ProductPreviewKind =
  | 'workflows'
  | 'knowledge'
  | 'tables'
  | 'files'
  | 'logs'
  | 'agents'
  | 'governance'

/**
 * `ssr: false` deep imports so no loop's client bundle - the editor stage,
 * the module tables, the third-party icon set they pull in - ships in the
 * server-rendered HTML for sections that start below the fold. Each product's
 * chunk loads only once its preview is actually requested.
 */
const PREVIEWS: Record<ProductPreviewKind, ComponentType> = {
  workflows: dynamic(
    () =>
      import('@/app/(landing)/workflows/components/workflows-editor-loop').then(
        (mod) => mod.WorkflowsEditorLoop
      ),
    { ssr: false }
  ),
  knowledge: dynamic(
    () =>
      import('@/app/(landing)/knowledge/components/knowledge-hero-loop').then(
        (mod) => mod.KnowledgeHeroLoop
      ),
    { ssr: false }
  ),
  tables: dynamic(
    () =>
      import('@/app/(landing)/tables/components/tables-hero-loop').then(
        (mod) => mod.TablesHeroLoop
      ),
    { ssr: false }
  ),
  files: dynamic(
    () =>
      import('@/app/(landing)/files/components/files-hero-loop').then((mod) => mod.FilesHeroLoop),
    { ssr: false }
  ),
  logs: dynamic(
    () => import('@/app/(landing)/logs/components/logs-hero-loop').then((mod) => mod.LogsHeroLoop),
    { ssr: false }
  ),
  agents: dynamic(
    () =>
      import('@/app/(landing)/components/platform-suite/components/build-agents-loop').then(
        (mod) => mod.BuildAgentsLoop
      ),
    { ssr: false }
  ),
  governance: dynamic(
    () =>
      import('@/app/(landing)/components/platform-suite/components/governance-loop').then(
        (mod) => mod.GovernanceLoop
      ),
    { ssr: false }
  ),
}

interface ProductPreviewProps {
  /** Which product's live loop to mount. */
  kind: ProductPreviewKind
}

/**
 * Client mount for one product's live platform loop - the same loops each
 * product page runs in its hero, reused on the homepage so every preview of
 * a Sim product is the product's own UI rather than a capture.
 *
 * Gated on viewport proximity via {@link useLazyMount} so a below-the-fold
 * window pulls neither the loop's JS nor its timers into the initial
 * homepage load. The host reserves the window's dimensions, so the empty
 * mount holds the slot with zero layout shift. Swapping `kind` on a mounted
 * preview swaps the loop in place; the viewport gate is already open.
 */
export function ProductPreview({ kind }: ProductPreviewProps) {
  const { ref, inView } = useLazyMount('400px')
  const Loop = PREVIEWS[kind]

  return (
    <div ref={ref} className='absolute inset-0'>
      {inView && <Loop />}
    </div>
  )
}
