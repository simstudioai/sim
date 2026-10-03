'use client'

import { useState } from 'react'
import { cn } from '@sim/emcn'
import { EnterpriseMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/enterprise-menu-preview'
import { FilesMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/files-menu-preview'
import { KnowledgeMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/knowledge-menu-preview'
import { LogsMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/logs-menu-preview'
import { OverviewMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/overview-menu-preview'
import { TablesMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/tables-menu-preview'
import { WorkflowMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/workflow-menu-preview'

const PREVIEWS = {
  overview: OverviewMenuPreview,
  enterprise: EnterpriseMenuPreview,
  workflows: WorkflowMenuPreview,
  knowledge: KnowledgeMenuPreview,
  files: FilesMenuPreview,
  tables: TablesMenuPreview,
  logs: LogsMenuPreview,
} as const

const HERO_ENTRANCE_CLASSES =
  'animate-in fade-in-0 fill-mode-backwards animation-duration-[160ms] ease-out motion-safe:animation-duration-[520ms] motion-safe:slide-in-from-bottom-3 motion-safe:zoom-in-[0.985] motion-safe:ease-[cubic-bezier(0.23,1,0.32,1)]'

interface ProductHeroPreviewProps {
  product: keyof typeof PREVIEWS
}

/** Feature-page heroes render the same UI as the corresponding navigation preview. */
export function ProductHeroPreview({ product }: ProductHeroPreviewProps) {
  const Preview = PREVIEWS[product]
  const [workflowReady, setWorkflowReady] = useState(false)
  const handleWorkflowReady = () => setWorkflowReady(true)
  const ready = product !== 'workflows' || workflowReady

  return (
    <div
      data-product-hero={product}
      className={cn(
        'relative isolate h-[420px] overflow-hidden max-lg:h-[400px]',
        product !== 'logs' && 'max-sm:h-[320px]'
      )}
    >
      <div
        data-product-hero-reveal
        data-ready={ready}
        className={cn(
          'absolute inset-0',
          ready ? HERO_ENTRANCE_CLASSES : 'pointer-events-none opacity-0'
        )}
      >
        {product === 'workflows' ? (
          <WorkflowMenuPreview layout='hero' onReady={handleWorkflowReady} />
        ) : (
          <Preview layout='hero' />
        )}
      </div>
    </div>
  )
}
