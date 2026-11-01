import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, SquareArrowUpRight } from '@sim/emcn/icons'
import Link from 'next/link'
import { ContentInteractions } from '@/components/docs/content-interactions'
import { Feedback } from '@/components/docs/feedback'
import { PageActions } from '@/components/docs/page-actions'
import { IntegrationIcon } from '@/components/ui/integration-icon'
import { getNavigation, getNeighbours } from '@/lib/content/catalog'
import { findNavigationGroup } from '@/lib/content/navigation'
import type { DocsPage } from '@/lib/content/types'

interface ArticleProps {
  page: DocsPage
  children: ReactNode
  aside?: ReactNode
}

export function Article({ page, children, aside }: ArticleProps) {
  const group =
    findNavigationGroup(getNavigation(page.section), page.url) ||
    { docs: 'Documentation', api: 'API reference', cli: 'CLI', mcp: 'MCP' }[page.section]
  const { previous, next } = getNeighbours(page)
  const source = page.operation
    ? `apps/sim/lib/api/contracts/v2`
    : `apps/docs/content/docs/${page.sourcePath}`
  const editUrl = `https://github.com/simstudioai/sim/${page.operation ? 'tree' : 'edit'}/staging/${source}`
  return (
    <main
      id='main-content'
      tabIndex={-1}
      className={
        aside
          ? 'grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-12 outline-none xl:grid-cols-[minmax(0,536px)_minmax(0,400px)]'
          : 'min-w-0 outline-none'
      }
    >
      <ContentInteractions />
      <div className='min-w-0'>
        <header className='mb-7 space-y-3'>
          <div className='flex min-h-7 items-center justify-between gap-4'>
            <p className='text-[var(--docs-muted)] text-docs-control'>{group}</p>
            <PageActions key={page.url} url={page.url} />
          </div>
          <h1 className='flex items-center gap-3 font-medium text-[var(--docs-heading)] text-docs-title tracking-[-0.02em] [overflow-wrap:anywhere]'>
            {page.integration && <IntegrationIcon {...page.integration} />}
            <span>{page.title}</span>
          </h1>
          {page.description && (
            <p className='text-[var(--docs-muted)] text-docs-lead'>{page.description}</p>
          )}
        </header>
        <article className='min-w-0'>{children}</article>
        <div className='mt-12 flex flex-wrap items-center justify-between gap-4 border-[var(--docs-border)] border-t pt-5 text-[var(--docs-muted)] text-docs-caption'>
          <Feedback key={page.url} page={page.url} />
          <a href={editUrl} className='flex items-center gap-1.5 hover:text-[var(--docs-heading)]'>
            Suggest an edit
            <SquareArrowUpRight className='size-4' />
          </a>
        </div>
        <nav
          aria-label='Page navigation'
          className='mt-8 flex justify-between gap-6 text-docs-control'
        >
          {previous?.url ? (
            <Link
              href={previous.url}
              className='group flex min-w-0 flex-1 flex-col items-start gap-2 py-2'
            >
              <span className='text-[var(--docs-muted)]'>Previous</span>
              <span className='flex items-center gap-1.5 group-hover:text-[var(--docs-link)]'>
                <ArrowLeft className='size-4 shrink-0' />
                {previous.title}
              </span>
            </Link>
          ) : (
            <div />
          )}
          {next?.url && (
            <Link
              href={next.url}
              className='group flex min-w-0 flex-1 flex-col items-end gap-2 py-2 text-right'
            >
              <span className='text-[var(--docs-muted)]'>Next</span>
              <span className='flex items-center gap-1.5 group-hover:text-[var(--docs-link)]'>
                {next.title}
                <ArrowRight className='size-4 shrink-0' />
              </span>
            </Link>
          )}
        </nav>
      </div>
      {aside && <aside className='min-w-0 xl:sticky xl:top-24'>{aside}</aside>}
    </main>
  )
}
