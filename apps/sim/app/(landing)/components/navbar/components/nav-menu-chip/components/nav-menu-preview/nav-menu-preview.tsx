import type { ReactNode } from 'react'
import { ArrowRight, BookOpen } from '@sim/emcn/icons'
import { BlogMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/blog-menu-preview'
import { ChangelogMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/changelog-menu-preview'
import { DocsMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/docs-menu-preview'
import { EnterpriseMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/enterprise-menu-preview'
import { FilesMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/files-menu-preview'
import { IntegrationsMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/integrations-menu-preview'
import { KnowledgeMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/knowledge-menu-preview'
import { LibraryMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/library-menu-preview'
import { LogsMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/logs-menu-preview'
import { OverviewMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/overview-menu-preview'
import { TablesMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/tables-menu-preview'
import { WorkflowMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/workflow-menu-preview'
import type {
  NavMenuItemData,
  NavMenuPreviewKind,
} from '@/app/(landing)/components/navbar/components/nav-menu-chip/types'

interface NavMenuPreviewProps {
  item: NavMenuItemData
  modelsPreview: ReactNode
}

interface PreviewGraphicProps {
  details: readonly [string, string, string]
}

interface ProductGraphicProps extends PreviewGraphicProps {
  kind: Exclude<NavMenuPreviewKind, 'models'>
}

const PREVIEW_ROW =
  'flex items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5'

function TeamGraphic({ details }: PreviewGraphicProps) {
  return (
    <div className='flex h-full flex-col justify-center gap-2 p-4'>
      {details.map((detail, index) => (
        <div key={detail} className={PREVIEW_ROW}>
          <span className='flex size-7 items-center justify-center rounded-md bg-[var(--surface-3)] text-[10px] text-[var(--text-muted)]'>
            0{index + 1}
          </span>
          <span className='flex-1 text-[12px] text-[var(--text-body)]'>{detail}</span>
          <ArrowRight className='size-[14px] text-[var(--text-icon)]' />
        </div>
      ))}
    </div>
  )
}

function ResourceGraphic({ details }: PreviewGraphicProps) {
  return (
    <div className='flex h-full flex-col p-4'>
      <div className='mb-3 flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5'>
        <BookOpen className='size-[14px] text-[var(--text-icon)]' />
        <span className='text-[12px] text-[var(--text-body)]'>Browse resources</span>
      </div>
      <div className='flex flex-1 flex-col justify-center divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3'>
        {details.map((detail) => (
          <div key={detail} className='flex flex-1 items-center justify-between'>
            <span className='text-[12px] text-[var(--text-body)]'>{detail}</span>
            <ArrowRight className='size-[14px] text-[var(--text-icon)]' />
          </div>
        ))}
      </div>
    </div>
  )
}

function PreviewGraphic({ kind, details }: ProductGraphicProps) {
  switch (kind) {
    case 'blog':
      return <BlogMenuPreview />
    case 'changelog':
      return <ChangelogMenuPreview />
    case 'docs':
      return <DocsMenuPreview />
    case 'integrations':
      return <IntegrationsMenuPreview />
    case 'library':
      return <LibraryMenuPreview />
    case 'overview':
      return <OverviewMenuPreview />
    case 'workflows':
      return <WorkflowMenuPreview />
    case 'knowledge':
      return <KnowledgeMenuPreview />
    case 'tables':
      return <TablesMenuPreview />
    case 'files':
      return <FilesMenuPreview />
    case 'logs':
      return <LogsMenuPreview />
    case 'enterprise':
      return <EnterpriseMenuPreview />
    case 'team':
      return <TeamGraphic details={details} />
    case 'resource':
      return <ResourceGraphic details={details} />
  }
}

export function NavMenuPreview({ item, modelsPreview }: NavMenuPreviewProps) {
  return (
    <div
      data-nav-menu-preview
      className='relative min-h-[340px] w-full self-stretch overflow-hidden rounded-[10px] bg-[var(--surface-3)]'
    >
      {item.preview.kind === 'models' ? (
        modelsPreview
      ) : (
        <PreviewGraphic kind={item.preview.kind} details={item.preview.details} />
      )}
    </div>
  )
}
